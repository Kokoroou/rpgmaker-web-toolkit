//=============================================================================
// RWK_Perf.js - rpgmaker-web-toolkit (dev tool, never deployed)
// Loaded by tools/perf/bench.js after the game's plugins and before RWK_Core.
// Records which engine functions each toolkit plugin replaces and runs the
// benchmark scenarios the bench drives over the DevTools protocol, through
// window.RWK_PERF. Every variant loads it, including the one without the
// toolkit, so its own cost is in the baseline too.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Benchmark probe (tools/perf only).
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  let cfg = {};
  try {
    cfg = JSON.parse(PluginManager.parameters("RWK_Perf").config || "{}");
  } catch (e) {
    console.error("[RWK_Perf] Invalid config", e);
  }
  const MZ = Utils.RPGMAKER_NAME === "MZ";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  async function until(test, timeoutMs = 20000) {
    const end = performance.now() + timeoutMs;
    while (!test()) {
      if (performance.now() > end) return false;
      await sleep(20);
    }
    return true;
  }

  // Seeded Math.random (mulberry32): NPC moves and encounters follow the same
  // course in every variant.
  let seedState = 1;
  function seed(n) {
    seedState = n >>> 0;
  }
  Math.random = function () {
    let t = (seedState = (seedState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Every WebAudio the engine creates, held weakly so the count after a GC is
  // what something else still holds (see audio()). Wrapped before the
  // snapshot below and before RWK_Report wraps it too.
  const created = [];
  const _createBuffer = AudioManager.createBuffer;
  AudioManager.createBuffer = function () {
    const buffer = _createBuffer.apply(this, arguments);
    if (buffer) created.push(new WeakRef(buffer));
    return buffer;
  };

  //---------------------------------------------------------------------------
  // Hooks: engine functions (globals' own and prototype methods) before and
  // after each RWK_*.js script runs. A script's load event fires right after
  // it has run.
  //---------------------------------------------------------------------------

  const nativeCode = /\[native code\]\s*\}\s*$/;
  const isNative = (fn) => nativeCode.test(Function.prototype.toString.call(fn));

  function addMethods(out, label, obj) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (key === "constructor") continue;
      const d = Object.getOwnPropertyDescriptor(obj, key);
      if (d && typeof d.value === "function") out.set(label + "." + key, d.value);
    }
  }

  function snapshot() {
    const out = new Map();
    for (const name of Object.getOwnPropertyNames(window)) {
      if (!/^[A-Z]/.test(name) || name === "RWK" || name === "RWK_PERF") continue;
      const d = Object.getOwnPropertyDescriptor(window, name);
      const value = d && d.value;
      if (typeof value === "function") {
        if (isNative(value)) continue;
        addMethods(out, name, value);
        if (value.prototype) addMethods(out, name + ".prototype", value.prototype);
      } else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        addMethods(out, name, value);
      }
    }
    return out;
  }

  const ownerOf = (label) => label.slice(0, label.lastIndexOf("."));
  const base = snapshot();
  const baseOwners = new Set([...base.keys()].map(ownerOf));
  let previous = base;
  const byPlugin = {}; // RWK_X -> ["Owner.method", ...] replaced or added on an engine object

  function changesSince(before, after) {
    const changed = [];
    for (const [label, fn] of after) {
      if (before.get(label) === fn) continue;
      // Methods of the toolkit's own new classes are not hooks.
      if (before.has(label) || baseOwners.has(ownerOf(label))) changed.push(label);
    }
    return changed;
  }

  document.addEventListener(
    "load",
    (e) => {
      const m = e.target && e.target.tagName === "SCRIPT" && /\/(RWK_\w+)\.js(?:$|\?)/.exec(e.target.src || "");
      if (!m || m[1] === "RWK_Perf") return;
      const now = snapshot();
      byPlugin[m[1]] = changesSince(previous, now);
      previous = now;
    },
    true
  );

  function hooks() {
    const now = snapshot();
    const late = changesSince(previous, now); // changed after the plugins loaded (at boot...)
    const all = changesSince(base, now);
    return { byPlugin, late, all };
  }

  function resolve(label) {
    const parts = label.split(".");
    const key = parts.pop();
    let obj = window;
    for (const p of parts) obj = obj && obj[p];
    return obj ? { obj, key } : null;
  }

  // Replaces obj[key] by wrap(original) and returns the undo.
  function patch(obj, key, wrap) {
    const own = Object.prototype.hasOwnProperty.call(obj, key);
    const original = obj[key];
    obj[key] = wrap(original);
    return () => {
      if (own) obj[key] = original;
      else delete obj[key];
    };
  }

  //---------------------------------------------------------------------------
  // Boot: time from navigation to the first scene after Scene_Boot.
  //---------------------------------------------------------------------------

  const sceneStarted = () => {
    const scene = SceneManager._scene;
    return scene && (scene.isStarted ? scene.isStarted() : SceneManager.isCurrentSceneStarted());
  };

  let bootMs = 0;
  let bootScene = "";
  const watchBoot = setInterval(() => {
    try {
      const scene = SceneManager._scene;
      if (scene && !(scene instanceof Scene_Boot) && sceneStarted()) {
        bootMs = performance.now();
        bootScene = scene.constructor.name;
        clearInterval(watchBoot);
      }
    } catch (e) {
      // The engine is still setting up.
    }
  }, 10);

  async function boot(timeoutMs = 60000) {
    if (!(await until(() => bootMs > 0, timeoutMs))) {
      const scene = SceneManager._scene ? SceneManager._scene.constructor.name : "no scene";
      const printer = document.getElementById("errorPrinter") || document.getElementById("ErrorPrinter");
      const shown = printer && printer.innerText.trim() ? `, error shown: ${printer.innerText.trim().slice(0, 200)}` : "";
      throw new Error(`the game did not get past Scene_Boot (now: ${scene}${shown})`);
    }
    return { bootMs, scene: bootScene };
  }

  //---------------------------------------------------------------------------
  // A new game on the start map.
  //---------------------------------------------------------------------------

  async function startGame() {
    seed(1);
    const onMap = () => SceneManager._scene instanceof Scene_Map && sceneStarted();
    const scene = SceneManager._scene;
    // The title's own New Game first (title plugins hook it), then the bare steps.
    if (scene instanceof Scene_Title && scene.commandNewGame) scene.commandNewGame();
    else {
      DataManager.setupNewGame();
      SceneManager.goto(Scene_Map);
    }
    let ok = await until(onMap, 8000);
    if (!ok && !(SceneManager._scene instanceof Scene_Map)) {
      // Some title screens stay "busy" (an animation...) and hold the change.
      if (!(SceneManager._nextScene instanceof Scene_Map)) {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
      }
      SceneManager._scene.isBusy = () => false;
      ok = await until(onMap, 20000);
    }
    if (!ok) {
      const scene = SceneManager._scene ? SceneManager._scene.constructor.name : "no scene";
      throw new Error(`the new game did not reach a map (now: ${scene}, started: ${!!sceneStarted()})`);
    }
    await until(() => !SceneManager.isSceneChanging() && !$gamePlayer.isTransferring(), 10000);
    for (let i = 0; i < 60; i++) await nextFrame();
    return { mapId: $gameMap.mapId(), eventRunning: $gameMap.isEventRunning() };
  }

  //---------------------------------------------------------------------------
  // Scripted input: walking in a square, or messages answered with OK.
  //---------------------------------------------------------------------------

  const DIRS = ["right", "down", "left", "up"];
  const TEXT = [
    "\\C[2]Benchmark\\C[0]: a line long enough to type out a while,",
    "with a second line of ordinary dialogue text in it,",
    "and a third one so the window fills like a real message.",
  ];

  function drive(kind, i) {
    const state = Input._currentState;
    if (kind === "walk") {
      const dir = DIRS[Math.floor(i / 40) % 4];
      for (const d of DIRS) state[d] = d === dir;
      state.ok = false;
    } else {
      for (const d of DIRS) state[d] = false;
      if (!$gameMessage.isBusy()) for (const line of TEXT) $gameMessage.add(line);
      state.ok = i % 10 < 5;
    }
  }

  function releaseKeys() {
    for (const d of DIRS) Input._currentState[d] = false;
    Input._currentState.ok = false;
  }

  // One frame of game logic, without drawing.
  const step = MZ
    ? () => SceneManager.updateMain()
    : () => {
        SceneManager.updateInputData();
        SceneManager.changeScene();
        SceneManager.updateScene();
      };

  // Game logic only, the game loop stopped: µs per frame for each chunk of frames.
  function tight(kind, steps = 1500, warmup = 300) {
    const CHUNK = 50;
    const samples = [];
    SceneManager.stop();
    try {
      seed(7);
      for (let i = 0; i < warmup; i++) {
        drive(kind, i);
        step();
      }
      for (let i = 0; i < steps; i += CHUNK) {
        const t = performance.now();
        for (let j = i; j < i + CHUNK; j++) {
          drive(kind, j);
          step();
        }
        samples.push(((performance.now() - t) / CHUNK) * 1000);
      }
      return { samples };
    } finally {
      releaseKeys();
      SceneManager.resume();
    }
  }

  // One real call of each hooked function seen in counts(): its this and arguments.
  const calls = {};
  const callSamples = {};

  // Calls per frame of each hooked function, walking then reading messages.
  function counts(labels, steps = 300) {
    const undo = [];
    for (const label of labels) {
      const target = resolve(label);
      if (!target || typeof target.obj[target.key] !== "function") continue;
      calls[label] = 0;
      undo.push(
        patch(target.obj, target.key, (fn) => function () {
          if (calls[label]++ === 50) callSamples[label] = { self: this, args: [...arguments] };
          return fn.apply(this, arguments);
        })
      );
    }
    SceneManager.stop();
    try {
      for (const kind of ["walk", "message"]) for (let i = 0; i < steps; i++) {
        drive(kind, i);
        step();
      }
    } finally {
      releaseKeys();
      for (const u of undo) u();
      SceneManager.resume();
    }
    const perFrame = {};
    for (const [label, n] of Object.entries(calls)) if (n) perFrame[label] = n / (2 * steps);
    return perFrame;
  }

  // What each hook adds per call: the engine's original and the hooked
  // function called by turns, in the same page (same JIT state), with the
  // this and arguments of a real call from counts(). Precise where comparing
  // page loads is not. -> { label: ns per call }
  function overhead(labels) {
    const out = {};
    const time = (fn, self, args, n) => {
      const t = performance.now();
      for (let i = 0; i < n; i++) fn.apply(self, args);
      return performance.now() - t;
    };
    SceneManager.stop();
    try {
      for (const label of labels) {
        const sample = callSamples[label];
        const original = base.get(label);
        const target = resolve(label);
        if (!sample || !original || !target) continue;
        const hooked = target.obj[target.key];
        try {
          // About 10 ms per block.
          const n = Math.max(20, Math.min(20000, Math.round(1000 / Math.max(0.0005, time(original, sample.self, sample.args, 100)))));
          time(original, sample.self, sample.args, n);
          time(hooked, sample.self, sample.args, n);
          let tOriginal = 0;
          let tHooked = 0;
          for (let r = 0; r < 6; r++) {
            tOriginal += time(original, sample.self, sample.args, n);
            tHooked += time(hooked, sample.self, sample.args, n);
          }
          out[label] = ((tHooked - tOriginal) / (6 * n)) * 1e6;
        } catch (e) {
          // A call that cannot repeat out of context: left out.
        }
      }
    } finally {
      releaseKeys();
      SceneManager.resume();
    }
    return out;
  }

  //---------------------------------------------------------------------------
  // Real time: the game loop running and drawing, the player walking.
  //---------------------------------------------------------------------------

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }

  async function realtime(seconds = 4) {
    let busy = 0;
    const timed = (fn) =>
      function () {
        const t = performance.now();
        try {
          return fn.apply(this, arguments);
        } finally {
          busy += performance.now() - t;
        }
      };
    // MZ draws outside updateMain; MV draws inside it.
    const undo = [patch(SceneManager, "updateMain", timed)];
    if (MZ && Graphics._app) undo.push(patch(Graphics._app, "render", timed));

    let i = 0;
    const walker = setInterval(() => drive("walk", (i += 2)), 50);
    const intervals = [];
    const cpu = [];
    try {
      await new Promise((resolve) => {
        const end = performance.now() + seconds * 1000;
        let last = 0;
        const tick = (t) => {
          if (last) {
            intervals.push(t - last);
            cpu.push(busy);
          }
          busy = 0;
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    } finally {
      clearInterval(walker);
      releaseKeys();
      for (const u of undo) u();
    }
    const si = [...intervals].sort((a, b) => a - b);
    const sc = [...cpu].sort((a, b) => a - b);
    const total = intervals.reduce((a, b) => a + b, 0);
    return {
      frames: intervals.length,
      fps: total ? (intervals.length * 1000) / total : 0,
      intervalP50: percentile(si, 50),
      intervalP95: percentile(si, 95),
      jankPct: intervals.length ? (100 * intervals.filter((x) => x > 20).length) / intervals.length : 0,
      cpuP50: percentile(sc, 50),
      cpuP95: percentile(sc, 95),
      cpuMean: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0,
    };
  }

  //---------------------------------------------------------------------------
  // Saving: what an autosave does on the map, the engine's own save steps
  // plus the toolkit's hooks on them (cloud sync uploads it after a delay).
  //---------------------------------------------------------------------------

  // Resolves at the next task, after the promise jobs queued so far (MZ
  // serializes and compresses in those).
  const nextTask = () =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });

  async function save(slot = 1, settleMs = 2500) {
    const tasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => tasks.push(...list.getEntries().map((e) => e.duration)));
      observer.observe({ type: "longtask" });
    } catch (e) {
      observer = null;
    }
    const bytes = JsonEx.stringify(DataManager.makeSaveContents()).length;
    $gameSystem.onBeforeSave();
    const t = performance.now();
    const result = DataManager.saveGame(slot);
    const syncMs = performance.now() - t;
    await nextTask();
    const blockMs = performance.now() - t;
    let ok = true;
    try {
      ok = (await Promise.resolve(result)) !== false;
    } catch (e) {
      ok = false;
    }
    const totalMs = performance.now() - t;
    await sleep(settleMs);
    if (observer) observer.disconnect();
    return { ok, bytes, syncMs, blockMs, totalMs, longestTask: tasks.length ? Math.max(...tasks) : 0 };
  }

  //---------------------------------------------------------------------------
  // Audio: play several BGM and SE files one after another, then stop. The
  // bench then counts the WebAudio objects still in memory after a GC.
  //---------------------------------------------------------------------------

  // Decoded audio of the WebAudio objects still alive (MV: _buffer, MZ: _buffers chunks).
  function audioLive() {
    const size = (b) => (b && b.length && b.numberOfChannels ? b.length * b.numberOfChannels * 4 : 0);
    let count = 0;
    let bytes = 0;
    for (const ref of created) {
      const a = ref.deref();
      if (!a) continue;
      count++;
      bytes += size(a._buffer);
      if (Array.isArray(a._buffers)) for (const b of a._buffers) bytes += size(b);
    }
    return { count, bytes };
  }

  async function audio(limit = 6) {
    const list = [
      ...(cfg.audio && cfg.audio.bgm ? cfg.audio.bgm : []).slice(0, limit).map((name) => ["bgm", name]),
      ...(cfg.audio && cfg.audio.se ? cfg.audio.se : []).slice(0, limit).map((name) => ["se", name]),
    ];
    let played = 0;
    let failed = 0;
    for (const [kind, name] of list) {
      const sound = { name, volume: 10, pitch: 100, pan: 0 };
      let buffer = null;
      try {
        if (kind === "bgm") {
          AudioManager.playBgm(sound);
          buffer = AudioManager._bgmBuffer;
        } else {
          AudioManager.playSe(sound);
          buffer = AudioManager._seBuffers[AudioManager._seBuffers.length - 1];
        }
      } catch (e) {
        failed++;
        continue;
      }
      await until(() => !buffer || buffer.isReady() || (buffer.isError && buffer.isError()), 8000);
      if (buffer && buffer.isReady()) played++;
      else failed++;
    }
    await sleep(1500); // MZ decodes the rest of a file in the background
    AudioManager.stopAll();
    await sleep(300);
    return { played, failed };
  }

  window.RWK_PERF = {
    engine: MZ ? "MZ" : "MV",
    seed,
    hooks,
    boot,
    startGame,
    tight,
    counts,
    overhead,
    realtime,
    save,
    audio,
    audioLive,
    stop: () => SceneManager.stop(),
    resume: () => SceneManager.resume(),
  };
})();
