import pino from 'pino';
import pretty from 'pino-pretty';
import type { SseEvent } from '$lib/types/sse';

export const encoder = new TextEncoder();
export const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

export function broadcastSse(data: SseEvent): void {
	const payload = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
	for (const controller of sseClients) {
		try {
			controller.enqueue(payload);
		} catch {
			sseClients.delete(controller);
		}
	}
}

const prettyStream = pretty({
	colorize: true,
	ignore: 'pid,hostname',
});

const customStream = {
	write(chunk: string | Buffer) {
		prettyStream.write(chunk);

		try {
			const logObject = JSON.parse(chunk.toString()) as { msg?: string; level?: number };
			const message = logObject.msg;
			if (message && (logObject.level ?? 0) >= 30) {
				broadcastSse({ type: 'log', level: logObject.level ?? 30, message });
			}
		} catch {
			const fallback = chunk.toString().trim();
			if (fallback) {
				broadcastSse({ type: 'log', level: 30, message: fallback });
			}
		}
	},
};

export const pinoLogger = pino(
	{
		level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
	},
	customStream,
);
