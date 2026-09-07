import { parentPort } from "node:worker_threads";
import { extractFromHtml } from "./reader-parse.js";
import { serializeExtractError } from "./reader-errors.js";

if (!parentPort) {
  throw new Error("reader.worker must run as a worker thread");
}

parentPort.on(
  "message",
  (msg: { id: number; html: string; url: string; forceArticle: boolean }) => {
    try {
      const result = extractFromHtml(msg.html, msg.url, { forceArticle: msg.forceArticle });
      parentPort!.postMessage({ id: msg.id, ok: true, result });
    } catch (err) {
      parentPort!.postMessage({ id: msg.id, ok: false, error: serializeExtractError(err) });
    }
  },
);
