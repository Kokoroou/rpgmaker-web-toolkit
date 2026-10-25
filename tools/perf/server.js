// Serves the game folder to the bench's Chrome, with the plugins of the
// variant being measured (js/plugins.js and runtime/RWK_*.js, read at each
// request) and the save API answered by the real Worker over an in-memory
// bucket. Never writes into the game folder.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { contentTypeOf } from "../../cli/lib/cloudflare.js";
import { createWorker } from "../../worker/index.js";

const MORE_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const typeOf = (rel) => MORE_TYPES[path.extname(rel).toLowerCase()] || contentTypeOf(rel);

// Cross-origin isolation gives performance.now() 5 µs steps instead of 100 µs.
const ISOLATION = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
};
const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// files: { "js/plugins/RWK_Perf.js": absolute path, ... } served instead of the game's.
export async function startServer({ root, runtimeDir, files = {} }) {
  const worker = createWorker();
  const state = { pluginsJs: "", env: null };

  async function api(req, res) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQUEST_HEADERS.has(k)) headers.set(k, String(v));
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const r = await worker.fetch(new Request("http://127.0.0.1" + req.url, { method: req.method, headers, body }), state.env);
    res.writeHead(r.status, { ...ISOLATION, ...Object.fromEntries(r.headers) });
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  function sendText(res, rel, text) {
    res.writeHead(200, { ...ISOLATION, "content-type": typeOf(rel), "cache-control": "no-store" });
    res.end(text);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      if (rel.startsWith("api/")) return await api(req, res);
      if (rel === "js/plugins.js") return sendText(res, rel, state.pluginsJs);
      if (files[rel]) return sendText(res, rel, fs.readFileSync(files[rel]));
      const own = /^js\/plugins\/(RWK_\w+)\.js$/.exec(rel);
      if (own && fs.existsSync(path.join(runtimeDir, own[1] + ".js"))) {
        return sendText(res, rel, fs.readFileSync(path.join(runtimeDir, own[1] + ".js")));
      }

      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403, ISOLATION);
        return res.end();
      }
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (!st || !st.isFile()) {
        res.writeHead(404, ISOLATION);
        return res.end();
      }
      // Game files are the same in every variant: let Chrome cache them.
      res.writeHead(200, { ...ISOLATION, "content-type": typeOf(rel), "content-length": st.size, "cache-control": "max-age=3600" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, ISOLATION);
      res.end(String(e && e.message));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    // pluginsJs: the js/plugins.js to serve; env: the Worker's env (a fresh bucket per run).
    use({ pluginsJs, env }) {
      state.pluginsJs = pluginsJs;
      state.env = env;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
