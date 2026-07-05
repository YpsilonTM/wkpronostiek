import { encoder, sseClients } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	let controller: ReadableStreamDefaultController<Uint8Array>;
	let heartbeat: ReturnType<typeof setInterval>;

	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
			sseClients.add(controller);

			try {
				controller.enqueue(encoder.encode(': connected\n\n'));
			} catch {
				// ignore
			}

			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					clearInterval(heartbeat);
					sseClients.delete(controller);
				}
			}, 20_000);
		},
		cancel() {
			clearInterval(heartbeat);
			sseClients.delete(controller);
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
};
