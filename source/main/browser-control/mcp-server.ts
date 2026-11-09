import {createHash, randomBytes} from 'node:crypto';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import type {AddressInfo} from 'node:net';
import {z} from 'zod';
import type {
	McpServerLease,
	SessionMcpServers,
} from '@/main/nanocoder/acp-client';

export const MCP_BODY_LIMIT = 64 * 1024;
const SERVER_NAME = 'nanocoder-desktop-browser';
const PATH = '/mcp';
const LATEST_PROTOCOL = '2025-06-18';
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', LATEST_PROTOCOL]);
const NO_ARGUMENTS = z.strictObject({});

export interface BrowserToolResult {
	text: string;
	isError?: boolean;
	image?: {data: string; mimeType: string};
}

export interface ToolContext {
	projectId: string;
	// Null until Nanocoder has named the session the secret was issued for.
	sessionId: string | null;
}

export interface BrowserTool {
	name: string;
	description: string;
	readOnly: boolean;
	// Without one, the tool takes no arguments.
	input?: z.ZodType;
	// Called only with arguments that passed `input`.
	call(
		context: ToolContext,
		args: never,
	): BrowserToolResult | Promise<BrowserToolResult>;
}

function jsonSchema(input: z.ZodType): object {
	const {$schema: _, ...schema} = z.toJSONSchema(input, {io: 'input'});
	return schema;
}

export interface BrowserMcpServer {
	start(): Promise<void>;
	forProject(projectId: string): SessionMcpServers;
	close(): Promise<void>;
}

interface Grant {
	projectId: string;
	sessionId: string | null;
	live: boolean;
}

type Id = string | number;

class HttpRefusal extends Error {
	constructor(
		readonly status: number,
		readonly headers: Record<string, string> = {},
	) {
		super(String(status));
	}
}

const digest = (secret: string): string =>
	createHash('sha256').update(secret).digest('hex');

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const collect = (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MCP_BODY_LIMIT) {
				chunks.push(chunk);
				return;
			}
			request.off('data', collect);
			request.resume();
			reject(new HttpRefusal(413));
		};
		request.on('data', collect);
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

const isId = (value: unknown): value is Id =>
	typeof value === 'string' ||
	(typeof value === 'number' && Number.isSafeInteger(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

export function createBrowserMcpServer(options: {
	version: string;
	tools: readonly BrowserTool[];
}): BrowserMcpServer {
	const tools = new Map(options.tools.map(tool => [tool.name, tool]));
	const schemas = new Map(
		options.tools.map(tool => [
			tool.name,
			jsonSchema(tool.input ?? NO_ARGUMENTS),
		]),
	);
	// Keyed by the secret's digest, so a lookup never compares secrets byte by byte.
	const grants = new Map<string, Grant>();
	let server: Server | undefined;
	let port: number | undefined;
	let closed = false;

	const authorise = (request: IncomingMessage): Grant => {
		const header = request.headers.authorization ?? '';
		const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
		const grant = match ? grants.get(digest(match[1])) : undefined;
		if (!grant) throw new HttpRefusal(401);
		return grant;
	};

	const check = (request: IncomingMessage): Grant => {
		// A browser always sends Origin on a cross-site POST; no legitimate MCP client does here.
		if (request.headers.origin !== undefined) throw new HttpRefusal(403);
		if (request.headers.host !== `127.0.0.1:${port}`)
			throw new HttpRefusal(403);
		const url = request.url ?? '';
		if (url !== PATH) throw new HttpRefusal(404);
		const grant = authorise(request);
		if (request.method !== 'POST') throw new HttpRefusal(405, {allow: 'POST'});
		const type = request.headers['content-type'] ?? '';
		if (!/^application\/json(\s*;|$)/i.test(type)) throw new HttpRefusal(415);
		if (Number(request.headers['content-length']) > MCP_BODY_LIMIT)
			throw new HttpRefusal(413);
		const version = request.headers['mcp-protocol-version'];
		if (version !== undefined && !PROTOCOLS.has(String(version)))
			throw new HttpRefusal(400);
		return grant;
	};

	const callTool = async (grant: Grant, params: unknown): Promise<object> => {
		if (!isRecord(params) || typeof params.name !== 'string')
			throw new RpcError(-32602, 'tools/call needs a tool name');
		const tool = tools.get(params.name);
		if (!tool) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
		const parsed = (tool.input ?? NO_ARGUMENTS).safeParse(
			params.arguments ?? {},
		);
		if (!parsed.success)
			throw new RpcError(
				-32602,
				`Invalid arguments for ${tool.name}: ${parsed.error.issues
					.slice(0, 3)
					.map(
						issue => `${issue.path.join('.') || 'arguments'} ${issue.message}`,
					)
					.join('; ')}`,
			);
		try {
			const result = await tool.call(
				{projectId: grant.projectId, sessionId: grant.sessionId},
				parsed.data as never,
			);
			return {
				content: [
					{type: 'text', text: result.text},
					...(result.image ? [{type: 'image', ...result.image}] : []),
				],
				isError: result.isError === true,
			};
		} catch {
			return {
				content: [{type: 'text', text: `${tool.name} failed in the desktop.`}],
				isError: true,
			};
		}
	};

	const dispatch = async (
		grant: Grant,
		method: string,
		params: unknown,
	): Promise<object> => {
		switch (method) {
			case 'initialize': {
				const requested = isRecord(params) ? params.protocolVersion : undefined;
				return {
					protocolVersion:
						typeof requested === 'string' && PROTOCOLS.has(requested)
							? requested
							: LATEST_PROTOCOL,
					capabilities: {tools: {listChanged: false}},
					serverInfo: {name: SERVER_NAME, version: options.version},
				};
			}
			case 'ping':
				return {};
			case 'tools/list':
				return {
					tools: [...tools.values()].map(tool => ({
						name: tool.name,
						description: tool.description,
						inputSchema: schemas.get(tool.name),
						annotations: {readOnlyHint: tool.readOnly},
					})),
				};
			case 'tools/call':
				return callTool(grant, params);
			default:
				throw new RpcError(-32601, `Method not found: ${method}`);
		}
	};

	const json = (response: ServerResponse, status: number, body: object) => {
		response.writeHead(status, {'content-type': 'application/json'});
		response.end(JSON.stringify(body));
	};

	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const grant = check(request);
		const raw = await readBody(request);
		let message: unknown;
		try {
			message = JSON.parse(raw.toString('utf8'));
		} catch {
			json(response, 400, {
				jsonrpc: '2.0',
				id: null,
				error: {code: -32700, message: 'Parse error'},
			});
			return;
		}
		if (
			!isRecord(message) ||
			message.jsonrpc !== '2.0' ||
			typeof message.method !== 'string' ||
			('id' in message && !isId(message.id))
		) {
			json(response, 400, {
				jsonrpc: '2.0',
				id: null,
				error: {code: -32600, message: 'Invalid request'},
			});
			return;
		}
		if (!('id' in message)) {
			response.writeHead(202).end();
			return;
		}
		const id = message.id as Id;
		try {
			const result = await dispatch(grant, message.method, message.params);
			// A secret released while the call ran has no answer to receive.
			if (!grant.live) throw new HttpRefusal(401);
			json(response, 200, {jsonrpc: '2.0', id, result});
		} catch (error) {
			if (!(error instanceof RpcError)) throw error;
			json(response, 200, {
				jsonrpc: '2.0',
				id,
				error: {code: error.code, message: error.message},
			});
		}
	};

	const onRequest = (request: IncomingMessage, response: ServerResponse) => {
		handle(request, response).catch((error: unknown) => {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			const refusal =
				error instanceof HttpRefusal ? error : new HttpRefusal(500);
			response.writeHead(refusal.status, {
				...refusal.headers,
				connection: 'close',
			});
			response.end();
		});
	};

	const lease = (projectId: string): McpServerLease | undefined => {
		if (!server || closed || port === undefined) return undefined;
		const secret = randomBytes(32).toString('base64url');
		const key = digest(secret);
		const grant: Grant = {projectId, sessionId: null, live: true};
		grants.set(key, grant);
		return {
			server: {
				type: 'http',
				name: SERVER_NAME,
				url: `http://127.0.0.1:${port}${PATH}`,
				headers: [{name: 'Authorization', value: `Bearer ${secret}`}],
			},
			bind: sessionId => {
				grant.sessionId ??= sessionId;
			},
			release: () => {
				grant.live = false;
				grants.delete(key);
			},
		};
	};

	return {
		async start() {
			if (closed || server) throw new Error('The browser server cannot start');
			const created = createServer(
				{maxHeaderSize: 16 * 1024, requestTimeout: 30_000},
				onRequest,
			);
			created.headersTimeout = 10_000;
			await new Promise<void>((resolve, reject) => {
				created.once('error', reject);
				created.listen({host: '127.0.0.1', port: 0}, () => {
					created.off('error', reject);
					resolve();
				});
			});
			server = created;
			port = (created.address() as AddressInfo).port;
		},
		forProject(projectId) {
			return {
				ready: () => !!server && !closed,
				lease: () => lease(projectId),
			};
		},
		async close() {
			const running = server;
			closed = true;
			for (const grant of grants.values()) grant.live = false;
			grants.clear();
			server = undefined;
			if (!running) return;
			await new Promise<void>(resolve => {
				running.close(() => resolve());
				running.closeAllConnections();
			});
		},
	};
}
