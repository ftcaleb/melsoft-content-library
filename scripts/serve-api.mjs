/* Serves the api/ functions locally, the way Vercel routes them, so the
   page can be run without `vercel dev`:

       npm run api   → http://localhost:3101/api/<name>
       npm run dev   → http://localhost:5174 (passes /api through to 3101)

   Reads .env.local when it exists. Without SMTP_USER/SMTP_PASS, sign-in
   links are printed here instead of emailed. Restart after editing api/:
   Node caches the modules. */
import http from "node:http";
import { readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..", "api");
const PORT = Number(process.env.PORT) || 3101;

const routes = new Map();
for (const entry of readdirSync(API, { withFileTypes: true })) {
  if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
    routes.set(`/api/${basename(entry.name, extname(entry.name))}`, join(API, entry.name));
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const file = routes.get(url.pathname.replace(/\/$/, ""));
  if (!file) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "no such function", available: [...routes.keys()] }));
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = Buffer.concat(chunks).toString();
  if ((req.headers["content-type"] || "").includes("application/json")) {
    try { body = JSON.parse(body); } catch { /* leave it as text */ }
  }

  // The slice of Vercel's request/response helpers the handlers use.
  const shim = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { res.setHeader(k, v); return this; },
    json(p) {
      if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
      res.writeHead(this.statusCode);
      res.end(JSON.stringify(p));
      return this;
    },
    send(p) { res.writeHead(this.statusCode); res.end(String(p)); return this; },
    end() { res.writeHead(this.statusCode); res.end(); return this; },
  };

  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default({ method: req.method, body, query: Object.fromEntries(url.searchParams), headers: req.headers }, shim);
  } catch (err) {
    console.error(`[api] ${url.pathname} threw:`, err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "handler threw", detail: String(err?.message) }));
  }
}).listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT}`);
  for (const r of routes.keys()) console.log(`        ${r}`);
});
