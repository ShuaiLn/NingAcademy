import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PHASE2_STUDY_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid study port");
const files = new Map();
const catalog = await readFile(resolve(root, "app/_lib/local-ai/asset-catalog.ts"), "utf8");
const entries = [...catalog.matchAll(/asset\("([^"]+)", "(ocr|ner)", "([^"]+)", "([^"]+)", ([\d_]+), "([a-f0-9]{64})", "([^"]+)", "([^"]+)"\)/g)];
if (entries.length !== 11) throw new Error("Re-review changed OCR/NER catalog");
for (const entry of entries) {
  const data = await readFile(resolve(root, "public" + entry[8]));
  if (data.length !== Number(entry[5].replaceAll("_", "")) || createHash("sha256").update(data).digest("hex") !== entry[6]) {
    throw new Error("Study asset integrity check failed");
  }
  files.set(entry[8], data);
}
for (const [url, file] of [["/", "index.html"], ["/study.css", "study.css"]]) {
  files.set(url, await readFile(resolve(root, "scripts/phase2/study", file)));
}
for (const [url, entryPoint] of [
  ["/study.js", "scripts/phase2/study/browser.ts"],
  ["/ner.worker.js", "app/_lib/local-ai/workers/ner.worker.ts"],
]) {
  const result = await build({ absWorkingDir: root, entryPoints: [entryPoint], bundle: true,
    format: "esm", platform: "browser", target: "es2022", write: false, minify: false,
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error" });
  files.set(url, result.outputFiles[0].contents);
}
const mime = url => url === "/" ? "text/html; charset=utf-8"
  : url.endsWith(".css") ? "text/css" : /\.m?js$/.test(url) ? "text/javascript"
  : url.endsWith(".wasm") ? "application/wasm" : url.endsWith(".json") ? "application/json" : "application/octet-stream";
const server = createServer((request, response) => {
  const origin = `http://${host}:${port}`;
  // Fixed GET-only allowlist: no user input, credentials, arbitrary files, or database endpoints.
  const url = new URL(request.url ?? "/", origin);
  if (request.headers.host !== `${host}:${port}` || request.method !== "GET" || url.search ||
      (request.headers.origin && request.headers.origin !== origin) || request.headers["sec-fetch-site"] === "cross-site") {
    response.writeHead(403); response.end(); return;
  }
  const file = files.get(url.pathname);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {
    "Content-Type": mime(url.pathname), "Content-Length": file.byteLength,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  response.end(file);
});
server.listen(port, host, () => console.log(`Synthetic-only Phase 2 study: http://${host}:${port} (11 assets hash-verified; no database)`));
