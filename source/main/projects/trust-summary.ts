import {createHash} from 'node:crypto';
import {constants, type Dirent} from 'node:fs';
import {lstat, open, opendir, stat} from 'node:fs/promises';
import path from 'node:path';
import {parseDocument} from 'yaml';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath, isInside} from '@/main/paths';

const labels = {
	plugins: 'plugins',
	hooks: 'hooks',
	mcpServers: 'MCP servers',
	formatters: 'formatters',
	lspServers: 'LSP servers',
	customTools: 'custom tools',
	subscribedSkills: 'subscribed skills',
	subscribedAgents: 'subscribed agents',
	subscribedCommands: 'subscribed commands',
	envFile: 'project .env files',
	permissionSettings: 'confirmation settings',
	providerEndpoints: 'provider endpoints',
} as const;

export interface TrustSummary {
	counts: Record<keyof typeof labels, number>;
	details: string;
	fingerprint: string;
}

function object(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new IpcFailure(
			'DENIED',
			'Project trust configuration cannot be summarised',
		);
	return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new IpcFailure(
			'DENIED',
			'Project trust configuration cannot be summarised',
		);
	return value;
}

function subscribed(name: string, body: string): boolean {
	const header = name.endsWith('.yaml')
		? body
		: /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1];
	if (!header) {
		if (/^---\r?\n/.test(body))
			throw new IpcFailure(
				'DENIED',
				'Project subscription metadata is incomplete',
			);
		return false;
	}
	const document = parseDocument(header, {prettyErrors: false});
	if (document.errors.length > 0)
		throw new IpcFailure(
			'DENIED',
			'Project subscription metadata cannot be summarised',
		);
	return object(document.toJS({maxAliasCount: 0})).subscribe !== undefined;
}

export async function readTrustSummary(root: string): Promise<TrustSummary> {
	try {
		return await inspect(root);
	} catch (error) {
		if (error instanceof IpcFailure) throw error;
		throw new IpcFailure(
			'DENIED',
			'Project trust declarations cannot be inspected',
		);
	}
}

async function inspect(root: string): Promise<TrustSummary> {
	if (
		!path.isAbsolute(root) ||
		(await canonicalPath(root)) !== root ||
		!(await stat(root)).isDirectory()
	)
		throw new IpcFailure(
			'DENIED',
			'Choose an available canonical project folder',
		);
	const hash = createHash('sha256').update(root);
	const maxFileBytes = 256 * 1024;
	let totalBytes = 0;
	let totalEntries = 0;
	const limit = () =>
		new IpcFailure(
			'LIMIT',
			'Project declarations exceed the safe inspection limit; review them before trusting',
		);
	const checked = async (name: string): Promise<string | undefined> => {
		let current = root;
		let canonical = root;
		for (const part of name.split('/')) {
			current = path.join(current, part);
			try {
				await lstat(current);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
				throw error;
			}
			canonical = await canonicalPath(current);
			if (!isInside(canonical, [root]))
				throw new IpcFailure(
					'DENIED',
					'A project declaration points outside the project',
				);
		}
		return canonical;
	};
	const read = async (name: string) => {
		const canonical = await checked(name);
		if (!canonical) return;
		const expected = await stat(canonical);
		if (!expected.isFile())
			throw new IpcFailure(
				'DENIED',
				'A project declaration is not a regular file',
			);
		const file = await open(
			canonical,
			constants.O_RDONLY |
				(constants.O_NOFOLLOW ?? 0) |
				(constants.O_NONBLOCK ?? 0),
		);
		try {
			const before = await file.stat();
			if (
				!before.isFile() ||
				before.dev !== expected.dev ||
				before.ino !== expected.ino
			)
				throw new IpcFailure(
					'DENIED',
					'A project declaration changed during inspection',
				);
			if (before.size > maxFileBytes) throw limit();
			const buffer = Buffer.alloc(maxFileBytes + 1);
			let length = 0;
			while (length < buffer.length) {
				const result = await file.read(
					buffer,
					length,
					buffer.length - length,
					length,
				);
				if (result.bytesRead === 0) break;
				length += result.bytesRead;
			}
			totalBytes += length;
			if (length > maxFileBytes || totalBytes > 2 * 1024 * 1024) throw limit();
			const after = await file.stat();
			const current = await checked(name);
			if (
				current !== canonical ||
				before.size !== length ||
				before.size !== after.size ||
				before.mtimeMs !== after.mtimeMs ||
				before.ctimeMs !== after.ctimeMs
			)
				throw new IpcFailure(
					'DENIED',
					'A project declaration changed during inspection',
				);
			const named = await stat(current);
			if (
				named.dev !== before.dev ||
				named.ino !== before.ino ||
				named.mtimeMs !== before.mtimeMs ||
				named.ctimeMs !== before.ctimeMs
			)
				throw new IpcFailure(
					'DENIED',
					'A project declaration changed during inspection',
				);
			const bytes = buffer.subarray(0, length);
			hash.update(JSON.stringify([name, length])).update(bytes);
			return bytes.toString('utf8');
		} finally {
			await file.close();
		}
	};
	const json = async (name: string) => {
		const body = await read(name);
		if (body === undefined) return {};
		try {
			return object(JSON.parse(body));
		} catch {
			throw new IpcFailure(
				'DENIED',
				'Project trust configuration cannot be summarised',
			);
		}
	};
	const walk = async (
		directory: string,
		recursive: boolean,
		accept: (name: string) => boolean,
		ancestors = new Set<string>(),
		depth = 0,
	): Promise<Array<{name: string; body: string}>> => {
		if (depth > 8) throw limit();
		const canonical = await checked(directory);
		if (!canonical) return [];
		if (ancestors.has(canonical) || !(await stat(canonical)).isDirectory())
			throw new IpcFailure(
				'DENIED',
				'Project declarations contain an invalid directory',
			);
		const parents = new Set(ancestors).add(canonical);
		const entries: Dirent[] = [];
		for await (const entry of await opendir(canonical)) {
			if (++totalEntries > 512) throw limit();
			entries.push(entry);
		}
		const files: Array<{name: string; body: string}> = [];
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const name = `${directory}/${entry.name}`;
			let isDirectory = entry.isDirectory();
			if (recursive && entry.isSymbolicLink()) {
				const target = await checked(name);
				if (!target)
					throw new IpcFailure('DENIED', 'A project declaration disappeared');
				isDirectory = (await stat(target)).isDirectory();
			}
			if (isDirectory && recursive) {
				files.push(
					...(await walk(name, recursive, accept, parents, depth + 1)),
				);
			} else if (accept(entry.name)) {
				const body = await read(name);
				if (body !== undefined) files.push({name, body});
			}
		}
		return files;
	};
	const counts = Object.fromEntries(
		Object.keys(labels).map(key => [key, 0]),
	) as TrustSummary['counts'];
	const markdown = (name: string) => name.endsWith('.md');
	counts.plugins = (
		await walk('.nanocoder/plugins', false, name => name.endsWith('.mjs'))
	).length;
	counts.customTools = (await walk('.nanocoder/tools', false, markdown)).length;
	const skills = await walk(
		'.nanocoder/skills',
		true,
		name => markdown(name) || name === 'skill.yaml',
	);
	const subscribedSkills = new Set<string>();
	for (const file of skills) {
		if (/\/tools\/.*\.md$/.test(file.name)) counts.customTools++;
		if (subscribed(file.name, file.body))
			subscribedSkills.add(file.name.split('/')[2] ?? file.name);
	}
	counts.subscribedSkills = subscribedSkills.size;
	for (const [directory, key, recursive] of [
		['agents', 'subscribedAgents', false],
		['commands', 'subscribedCommands', true],
	] as const) {
		counts[key] = (
			await walk(`.nanocoder/${directory}`, recursive, markdown)
		).filter(file => subscribed(file.name, file.body)).length;
	}
	const config = await json('agents.config.json');
	const nanocoder = object(config.nanocoder);
	counts.hooks = Object.values(object(nanocoder.hooks)).reduce<number>(
		(count, entries) => count + array(entries).length,
		0,
	);
	counts.formatters = array(nanocoder.formatters).length;
	counts.lspServers = array(nanocoder.lspServers).length;
	counts.permissionSettings = [
		nanocoder.alwaysAllow,
		nanocoder.defaultMode,
		nanocoder.sandbox,
		object(nanocoder.verify).trustLevel,
	].filter(value => value !== undefined).length;
	counts.providerEndpoints = array(
		nanocoder.providers ?? config.providers,
	).filter(provider => object(provider).baseUrl !== undefined).length;
	counts.mcpServers = Object.keys(
		object((await json('.mcp.json')).mcpServers),
	).length;
	const environment = await checked('.env');
	if (environment) {
		const env = await stat(environment);
		if (!env.isFile())
			throw new IpcFailure(
				'DENIED',
				'The project environment is not a regular file',
			);
		counts.envFile = 1;
		hash.update(
			`env:${env.dev}:${env.ino}:${env.size}:${env.mtimeMs}:${env.ctimeMs}`,
		);
	}
	return {
		counts,
		fingerprint: hash.digest('hex'),
		details: [
			'Project declarations Nanocoder may run or load:',
			...Object.entries(labels).map(
				([key, label]) => `${label}: ${counts[key as keyof typeof labels]}`,
			),
			'Provider endpoints may receive prompts and code.',
			"Nanocoder's user configuration also applies. Trust is not a sandbox.",
		].join('\n'),
	};
}
