import pino from "pino";
import pretty from "pino-pretty";

const encoder = new TextEncoder();
const sseClients = new Set();

const prettyStream = pretty({
  colorize: true,
  ignore: "pid,hostname",
});

const customStream = {
  write(chunk) {
    // Write to pino-pretty for terminal output
    prettyStream.write(chunk);

    // Broadcast to SSE clients
    try {
      const logObject = JSON.parse(chunk.toString());
      const message = logObject.msg;
      // Only broadcast info level (30) or higher to the webpage
      if (message && logObject.level >= 30) {
        const payload = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
        for (const controller of sseClients) {
          try {
            controller.enqueue(payload);
          } catch {
            sseClients.delete(controller);
          }
        }
      }
    } catch (e) {
      // Fallback for non-JSON logs or parsing errors
      const payload = encoder.encode(`data: ${JSON.stringify(chunk.toString().trim())}\n\n`);
      for (const controller of sseClients) {
        try {
          controller.enqueue(payload);
        } catch {
          sseClients.delete(controller);
        }
      }
    }
  }
};

const pinoLogger = pino(
  {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
  },
  customStream
);

export { pinoLogger, sseClients, encoder };
