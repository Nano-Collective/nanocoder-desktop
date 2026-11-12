import {execFileSync} from 'node:child_process';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FileService} from '@/main/files/file-service';
import {FILE_LIMITS} from '@/main/files/limits';
import {GitService} from '@/main/git/git-service';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	requireCli,
	runtime,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {
	SCRIPTED_MODEL,
	startScriptedProvider,
} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';
import {
	BUDGETS,
	formatReport,
	largestDirectory,
	largestFileUnder,
	parseArgs,
	summarise,
	verdict,
} from './lib/perf.mjs';

// Phase 4.8: times the desktop's own file and Git services on a large repository (PERF-05 to PERF-08)
// and, with --resume, a real Nanocoder opening and resuming a session in it (PERF-02).
// Usage: pnpm measure:project [--repo /path/to/repository] [--runs 5] [--json report.json] [--resume] [--no-fail]
// Without --repo it builds a repository of about 120,000 files in a temporary folder and removes it afterwards.
// It never writes to a repository it did not create.
const options = parseArgs(process.argv.slice(2));
const BINARY =
	/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|jar|class|so|dylib|dll|exe|bin|woff2?|ttf|otf|mp[34]|mov|wasm|node|lock)$/iu;

const git = (cwd, ...args) =>
	execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 512 * 1_048_576,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Measure',
			GIT_AUTHOR_EMAIL: 'measure@example.com',
			GIT_COMMITTER_NAME: 'Measure',
			GIT_COMMITTER_EMAIL: 'measure@example.com',
		},
	});

function generate() {
	const root = realpathSync.native(
		mkdtempSync(path.join(os.tmpdir(), 'nd-large-project-')),
	);
	git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
	git(root, 'config', 'core.autocrlf', 'false');
	for (let directory = 0; directory < 1_000; directory++) {
		const folder = path.join(root, `d${directory}`);
		mkdirSync(folder);
		for (let file = 0; file < 100; file++)
			writeFileSync(
				path.join(folder, `f${file}.txt`),
				`${directory}-${file}\n`,
			);
	}
	const wide = path.join(root, 'wide');
	mkdirSync(wide);
	for (let file = 0; file < 20_000; file++)
		writeFileSync(path.join(wide, `w${file}`), '');
	writeFileSync(path.join(root, 'big.txt'), 'seed\n');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'fixture');
	writeFileSync(
		path.join(root, 'big.txt'),
		`${'0123456789abcdef'.repeat(60_000)}\n`,
	);
	return root;
}

// Opens a project and resumes a saved session with a real Nanocoder and a scripted model. Its configuration and
// sessions live in a temporary folder, so the only thing it touches in the repository is what Nanocoder itself does there.
async function measureResume(root, runs) {
	requireCli();
	const work = realpathSync.native(
		mkdtempSync(path.join(os.tmpdir(), 'nd-large-resume-')),
	);
	const provider = await startScriptedProvider([{text: 'a saved reply'}]);
	try {
		const configDir = path.join(work, 'config');
		mkdirSync(configDir);
		writeFileSync(
			path.join(configDir, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					providers: [
						{
							name: 'Scripted',
							baseUrl: provider.baseUrl,
							models: [SCRIPTED_MODEL],
						},
					],
				},
			}),
		);
		const env = {
			...process.env,
			NANOCODER_CONFIG_DIR: configDir,
			NANOCODER_DATA_DIR: path.join(work, 'data'),
			NODE_ENV: undefined,
		};
		await trustDirectory({runtime, root, env});
		const first = await connectNanocoder({runtime, root, env, clientInfo});
		const session = await first.newSession('normal');
		await first.prompt(session.id, 'save a session');
		await first.close();
		const opens = [];
		const resumes = [];
		for (let run = 0; run < runs; run++) {
			const opened = await time(() =>
				connectNanocoder({runtime, root, env, clientInfo}),
			);
			opens.push(opened.ms);
			try {
				const resumed = await time(() =>
					opened.result.resumeSession(session.id, 'normal'),
				);
				resumes.push(resumed.ms);
			} finally {
				await opened.result.close();
			}
		}
		return {opens: summarise(opens), resumes: summarise(resumes)};
	} finally {
		await provider.close();
		rmSync(work, {recursive: true, force: true});
	}
}

function time(action) {
	const started = performance.now();
	return Promise.resolve(action()).then(result => ({
		ms: performance.now() - started,
		result,
	}));
}

async function repeat(runs, action) {
	const samples = [];
	let last;
	for (let run = 0; run < runs; run++) {
		const {ms, result} = await time(() => action(run));
		samples.push(ms);
		last = result;
	}
	return {ms: summarise(samples), last};
}

async function main() {
	const generated = options.repo === undefined;
	const root = generated
		? generate()
		: realpathSync.native(path.resolve(options.repo));
	try {
		const top = git(root, 'rev-parse', '--show-toplevel').trim();
		if (realpathSync.native(top) !== root)
			throw new Error(`${root} is not the top of a Git repository`);
		const tracked = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
		const fullest = largestDirectory(tracked);
		const files = [];
		for (const file of tracked) {
			if (BINARY.test(file)) continue;
			try {
				const stat = lstatSync(path.join(root, file));
				if (stat.isFile()) files.push({path: file, size: stat.size});
			} catch {}
		}
		const project = {
			id: 'project',
			canonicalRoot: root,
			sessionCwd: root,
			displayName: 'measured',
			trusted: true,
			defaultMode: 'normal',
			availability: 'available',
			createdAt: '',
			lastOpenedAt: '',
		};
		const filesService = new FileService({project: () => project});
		const gitService = new GitService({
			project: () => project,
			roots: () => [],
		});
		const measurements = [];

		const listing = await repeat(options.runs, () =>
			filesService.list({projectId: 'project', path: fullest.directory}),
		);
		measurements.push({
			id: 'PERF-05',
			what: 'list the fullest directory',
			ms: listing.ms,
			detail: `${listing.last.entries.length} of ${listing.last.entries.length + listing.last.notShown} entries shown`,
		});

		const candidate = largestFileUnder(
			files.filter(file => file.size <= FILE_LIMITS.previewBytes),
			FILE_LIMITS.previewBytes,
		);
		if (candidate) {
			const preview = await repeat(options.runs, () =>
				filesService.preview({projectId: 'project', path: candidate.path}),
			);
			measurements.push({
				id: 'PERF-06',
				what: 'preview the largest text file up to 1 MiB',
				ms: preview.ms,
				detail: `${candidate.path}, ${candidate.size} bytes, shown as ${preview.last.kind}`,
			});
		} else
			measurements.push({
				id: 'PERF-06',
				what: 'preview the largest text file up to 1 MiB',
				skipped: 'no tracked text file of that size',
			});

		let changed;
		const status = await repeat(options.runs, async () => {
			gitService.invalidate('project');
			return gitService.status('project');
		});
		const statusResult = status.last;
		measurements.push({
			id: 'PERF-07',
			what: 'git status',
			ms: status.ms,
			detail: statusResult.available
				? `${tracked.length} tracked files, ${statusResult.entries.length} changes`
				: `${tracked.length} tracked files, unavailable: ${statusResult.reason}`,
		});
		if (statusResult.available)
			changed = statusResult.entries.find(entry => {
				const known = files.find(file => file.path === entry.path);
				return known && known.size <= FILE_LIMITS.previewBytes;
			});

		if (changed) {
			const diff = await repeat(options.runs, async () => {
				gitService.invalidate('project');
				return gitService.diff('project', changed.path, false);
			});
			measurements.push({
				id: 'PERF-08',
				what: 'diff of one changed file',
				ms: diff.ms,
				detail: `${changed.path}, shown as ${diff.last.kind}`,
			});
		} else
			measurements.push({
				id: 'PERF-08',
				what: 'diff of one changed file',
				skipped:
					'the repository has no modified tracked file up to 1 MiB, and this script never edits a repository it did not create',
			});

		if (options.resume) {
			const result = await measureResume(root, options.runs);
			measurements.push(
				{
					id: 'PERF-02',
					what: 'open the project: spawn to initialize answered',
					ms: result.opens,
					detail: 'recorded, investigate over 5000 ms',
				},
				{
					id: 'RESUME',
					what: 'resume a saved session',
					ms: result.resumes,
					detail: 'recorded',
				},
			);
		}

		const report = {
			machine: {
				platform: `${process.platform} ${process.arch}`,
				cpu: os.cpus()[0]?.model ?? 'unknown',
				cores: os.cpus().length,
				memoryGb: Math.round(os.totalmem() / 1024 ** 3),
				node: process.version,
				git: git(root, '--version')
					.trim()
					.replace(/^git version /u, ''),
			},
			repository: {
				kind: generated ? 'generated' : 'real',
				files: tracked.length,
				directory: fullest.directory,
				directoryEntries: fullest.entries,
			},
			runs: options.runs,
			measurements,
		};
		console.log(formatReport(report));
		if (options.json)
			writeFileSync(options.json, `${JSON.stringify(report, null, '\t')}\n`);
		const over = measurements.filter(
			item =>
				item.ms && item.id in BUDGETS && !verdict(item.id, item.ms.median).ok,
		);
		if (over.length > 0 && !options.noFail) {
			console.error(`Over budget: ${over.map(item => item.id).join(', ')}`);
			process.exitCode = 1;
		}
	} finally {
		if (generated) rmSync(root, {recursive: true, force: true});
	}
}

await main();
