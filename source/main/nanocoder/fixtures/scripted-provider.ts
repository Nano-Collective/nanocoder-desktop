import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

export type Reply =
	| {text: string}
	| {toolCall: {name: string; arguments: Record<string, unknown>}};

export interface ChatRequest {
	messages: Array<{role: string; content?: unknown}>;
	tools?: unknown[];
	stream?: boolean;
}

export interface ScriptedProvider {
	baseUrl: string;
	// Every chat request the model received, in order.
	requests: ChatRequest[];
	close(): Promise<void>;
}

const MODEL = 'scripted-model';

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function chunk(delta: object, finishReason: string | null = null): string {
	return `data: ${JSON.stringify({
		id: 'chatcmpl-scripted',
		object: 'chat.completion.chunk',
		created: 0,
		model: MODEL,
		choices: [{index: 0, delta, finish_reason: finishReason}],
	})}\n\n`;
}

function streamed(reply: Reply): string {
	if ('text' in reply) {
		return (
			chunk({role: 'assistant', content: reply.text}) +
			chunk({}, 'stop') +
			'data: [DONE]\n\n'
		);
	}
	const {name, arguments: args} = reply.toolCall;
	return (
		chunk({
			role: 'assistant',
			tool_calls: [
				{
					index: 0,
					id: `call_${name}`,
					type: 'function',
					function: {name, arguments: JSON.stringify(args)},
				},
			],
		}) +
		chunk({}, 'tool_calls') +
		'data: [DONE]\n\n'
	);
}

function complete(reply: Reply): object {
	const message =
		'text' in reply
			? {role: 'assistant', content: reply.text}
			: {
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: `call_${reply.toolCall.name}`,
							type: 'function',
							function: {
								name: reply.toolCall.name,
								arguments: JSON.stringify(reply.toolCall.arguments),
							},
						},
					],
				};
	return {
		id: 'chatcmpl-scripted',
		object: 'chat.completion',
		created: 0,
		model: MODEL,
		choices: [
			{
				index: 0,
				message,
				finish_reason: 'text' in reply ? 'stop' : 'tool_calls',
			},
		],
		usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
	};
}

// Replies go to requests that offer tools, which are the agent's turns. Anything else
// (a title, a summary) gets `fallback`, so it cannot use up a scripted reply.
export async function startScriptedProvider(
	script: readonly Reply[],
	fallback: Reply = {text: 'ok'},
): Promise<ScriptedProvider> {
	const queue = [...script];
	const requests: ChatRequest[] = [];
	const server: Server = createServer(async (request, response) => {
		if (
			request.method !== 'POST' ||
			!request.url?.endsWith('/chat/completions')
		) {
			response.writeHead(404).end();
			return;
		}
		const body = JSON.parse(await readBody(request)) as ChatRequest;
		requests.push(body);
		const agentTurn = Array.isArray(body.tools) && body.tools.length > 0;
		const reply = (agentTurn ? queue.shift() : undefined) ?? fallback;
		if (body.stream === false) {
			response.writeHead(200, {'content-type': 'application/json'});
			response.end(JSON.stringify(complete(reply)));
			return;
		}
		response.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
		});
		response.end(streamed(reply));
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () =>
			new Promise<void>(resolve => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

export const SCRIPTED_MODEL = MODEL;
