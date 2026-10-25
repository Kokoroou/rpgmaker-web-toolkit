// Starts Google Chrome (or Edge / Chromium) and drives it over the DevTools
// protocol with Node's built-in WebSocket, so the bench needs no npm package.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
};

export function findChrome(given) {
  const list = [given, process.env.CHROME_PATH, ...(CANDIDATES[process.platform] || [])].filter(Boolean);
  const found = list.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome not found: pass --chrome <path> or set CHROME_PATH.");
  return found;
}

class Cdp {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Cdp(ws));
      ws.onerror = () => reject(new Error("Could not connect to Chrome's DevTools port."));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (e) => this.#receive(JSON.parse(e.data));
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error("Chrome closed the DevTools connection."));
      this.pending.clear();
    };
  }

  #receive(msg) {
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
  }

  // Every call fails after 5 minutes rather than hang the bench.
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from Chrome in 5 min`));
      }, 300000);
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject), method });
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

export async function launchChrome({ executable, headed = false }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-perf-"));
  const proc = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      // Headless Chrome otherwise draws WebGL in software at a few frames per second.
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(headed ? [] : ["--headless=new"]),
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 20000;
  let lines = [];
  while (lines.length < 2) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited (code ${proc.exitCode}) before opening its DevTools port.`);
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error("Chrome did not open its DevTools port in 20 s.");
    }
    await sleep(100);
    if (fs.existsSync(portFile)) lines = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  }
  const cdp = await Cdp.connect(`ws://127.0.0.1:${lines[0]}${lines[1]}`);

  return {
    cdp,
    async close() {
      try {
        await Promise.race([cdp.send("Browser.close"), sleep(3000)]);
      } catch {
        // Already gone.
      }
      if (proc.exitCode === null) {
        proc.kill();
        await new Promise((resolve) => proc.once("exit", resolve));
      }
      // Chrome's child processes may hold files a moment longer on Windows.
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    },
  };
}

// A tab with the domains the bench uses enabled.
export async function openPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const errors = [];
  cdp.on("Runtime.exceptionThrown", (params, from) => {
    if (from !== sessionId) return;
    const d = params.exceptionDetails;
    errors.push((d.exception && d.exception.description) || d.text);
  });
  for (const domain of ["Page", "Runtime", "Performance", "HeapProfiler"]) await send(`${domain}.enable`);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  async function evaluate(expression, timeoutMs = 120000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000} s: ${expression}`)), timeoutMs);
    });
    try {
      const res = await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), timeout]);
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text);
      }
      return res.result.value;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    send,
    errors,
    evaluate,
    async waitFor(expression, timeoutMs = 60000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        try {
          if (await evaluate(`!!(${expression})`, 5000)) return;
        } catch {
          // The page is still loading.
        }
        await sleep(100);
      }
      throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${expression}`);
    },
    async metrics() {
      const { metrics } = await send("Performance.getMetrics");
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    },
    async gc() {
      await send("HeapProfiler.collectGarbage");
      await send("HeapProfiler.collectGarbage");
    },
    viewport(width, height, mobile = false) {
      return send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    },
  };
}
