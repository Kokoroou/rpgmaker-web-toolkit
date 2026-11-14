// The web build of a game folder, served on this PC for `rwk test` as the site
// would serve it: the real Worker (worker/index.js) in front, the save API on an
// in-memory bucket, and the static files with the web's rules, not the PC's:
// a name differs from the file's by letter case -> 404, as on Cloudflare, even
// on Windows and macOS, whose disks ignore case. Never writes into the game folder.

import fs from "node:fs";
import http from "node:http";
import { contentTypeOf } from "./cloudflare.js";
import { MemoryBucket } from "./memory-bucket.js";
import { createWorker } from "../../worker/index.js";

const MORE_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
const typeOf = (rel) => MORE_TYPES[(/\.[^./]+$/.exec(rel) || [""])[0].toLowerCase()] || contentTypeOf(rel);
const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

// files: collectFiles() of the game; generated: generatedFiles() (rel -> text), served instead.
// -> (rel) => { body: string | null, file: abs | null, size } | null, and the files that differ only by case.
export function buildIndex(files, generated) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const byLower = new Map();
  for (const rel of [...byRel.keys(), ...generated.keys()]) byLower.set(rel.toLowerCase(), rel);
  return {
    find(rel) {
      if (generated.has(rel)) return { body: generated.get(rel) };
      const f = byRel.get(rel);
      return f ? { file: f.abs, size: f.size } : null;
    },
    // The real name of a file asked with another letter case, or null.
    caseOf(rel) {
      const real = byLower.get(rel.toLowerCase());
      return real && real !== rel ? real : null;
    },
  };
}

// The Worker's static assets binding over the index (wrangler's assets: "/" is index.html).
function assetsOf(index) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      let rel;
      try {
        rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      } catch {
        return new Response("Bad path", { status: 400 });
      }
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const hit = index.find(rel);
      if (!hit) return new Response("Not found", { status: 404 });
      const headers = { "content-type": typeOf(rel), "cache-control": "no-store" };
      if (hit.body !== undefined) return new Response(request.method === "HEAD" ? null : hit.body, { headers });
      return new Response(request.method === "HEAD" ? null : fs.readFileSync(hit.file), { headers: { ...headers, "content-length": String(hit.size) } });
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// A Worker request from a Node one.
export async function toRequest(req, origin) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQUEST_HEADERS.has(k)) headers.set(k, String(v));
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  return new Request(origin + req.url, { method: req.method, headers, body });
}

// vars: workerVars() of the test site. -> { origin, close() }
export async function startTestServer({ files, generated, vars }) {
  const index = buildIndex(files, generated);
  const worker = createWorker();
  const env = { ...vars, BUCKET: new MemoryBucket(), ASSETS: assetsOf(index) };
  let origin = "";

  const server = http.createServer(async (req, res) => {
    try {
      const r = await worker.fetch(await toRequest(req, origin), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e && e.message));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    caseOf: (rel) => index.caseOf(rel),
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// The save API of a test on a deployed site: answered here, on an in-memory
// bucket, so the test never reads or overwrites a player's cloud saves (on a
// site without Access, every player shares one set). -> (Request) => Response
export function localSaveApi(vars) {
  const worker = createWorker();
  const env = { ...vars, AUTH_MODE: "none", RWK_LOCKED: "0", BUCKET: new MemoryBucket() };
  return (request) => worker.fetch(request, env);
}
