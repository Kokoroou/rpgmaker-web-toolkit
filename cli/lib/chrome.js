// Starts Google Chrome (or Edge / Chromium) and drives it over the DevTools
// protocol with Node's built-in WebSocket, so neither `rwk test` nor the bench
// (tools/perf) needs an npm package or a browser download.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A wait that does not keep Node running by itself (the caps in close()).
const cap = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

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

// given (a path the caller has), else CHROME_PATH, else the usual places of `candidates`.
export function findChrome(given, { env = process.env, candidates = CANDIDATES[process.platform] || [] } = {}) {
  const list = [given, env.CHROME_PATH, ...candidates].filter(Boolean);
  const found = list.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome not found: install Google Chrome (or Edge / Chromium), or set CHROME_PATH to its program file.");
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
    ws.onclose = () => this.#dropPending();
  }

  #dropPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Chrome closed the DevTools connection."));
    }
    this.pending.clear();
  }

  // Ends the connection and every call still waiting: nothing of it keeps Node running.
  close() {
    this.#dropPending();
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
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

  // Every call fails after 5 minutes rather than hang the run.
  send(method, params = {}, sessionId) {
    // A closed connection would take the message and never answer.
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${method}: Chrome's DevTools connection is closed.`));
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from Chrome in 5 min`));
      }, 300000);
      // A call left waiting (Browser.close as Chrome quits) must not keep Node running.
      timer.unref();
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject), method, timer });
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

export async function launchChrome({ executable, headed = false }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-chrome-"));
  // Chrome refuses to start its sandbox as root (a CI container, a Docker image).
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
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
      ...(asRoot ? ["--no-sandbox"] : []),
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
  let closed = false;

  return {
    cdp,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await Promise.race([cdp.send("Browser.close"), cap(3000)]);
      } catch {
        // Already gone.
      }
      cdp.close();
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise((resolve) => proc.once("exit", resolve));
        // On Windows, kill() ends chrome.exe alone: its GPU, network and crash
        // helpers live on and hold the run open. taskkill /T ends the whole tree.
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else proc.kill();
        await Promise.race([exited, cap(5000)]);
      }
      proc.unref();
      // Chrome's child processes may hold or still write files a moment longer
      // (Windows, a busy CI runner): a profile left in the temp folder is no failure.
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // The OS cleans its temp folder.
      }
    },
  };
}

// A tab with the Page, Runtime, Performance and HeapProfiler domains enabled.
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
    // A DevTools event of this tab only.
    on(method, fn) {
      cdp.on(method, (params, from) => {
        if (from === sessionId) fn(params);
      });
    },
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
