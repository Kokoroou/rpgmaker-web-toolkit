import assert from "node:assert/strict";
import { test } from "node:test";
import { RUNTIME_PLUGINS } from "../cli/lib/stage.js";
import { combine, findings, fmt, formatReport, median, metricsOf, parseVariants } from "../tools/perf/stats.js";

test("bench variants: none is always the baseline", () => {
  const ids = (spec) => parseVariants(spec, RUNTIME_PLUGINS).map((v) => v.id);
  assert.deepEqual(ids("all"), ["none", "all"]);
  assert.deepEqual(ids("none,core,+Speed,-Report"), ["none", "core", "+Speed", "-Report"]);
  assert.deepEqual(ids("each").length, RUNTIME_PLUGINS.length); // none + one per plugin but Core
  assert.deepEqual(ids("+RWK_Core,core,+speed,+Speed"), ["none", "core", "+Speed"]);

  const [, speed, noReport] = parseVariants("+Speed,-Report", RUNTIME_PLUGINS);
  assert.deepEqual(speed.plugins, ["RWK_Core", "RWK_Speed"]);
  assert.equal(noReport.plugins.length, RUNTIME_PLUGINS.length - 1);
  assert.ok(!noReport.plugins.includes("RWK_Report"));

  assert.throws(() => parseVariants("-Core", RUNTIME_PLUGINS), /cannot be left out/);
  assert.throws(() => parseVariants("+Nope", RUNTIME_PLUGINS), /Unknown plugin/);
  assert.throws(() => parseVariants("some", RUNTIME_PLUGINS), /Unknown variant/);
});

test("bench statistics", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(fmt(1234.5), "1235");
  assert.equal(fmt(12.345), "12.3");
  assert.equal(fmt(-0.5), "-0.50");
  assert.equal(fmt(NaN), "–");

  const m = metricsOf({
    boot: { bootMs: 600 },
    walk: { samples: [10, 30, 20] },
    message: { samples: [5] },
    realtime: { cpuP50: 2, cpuP95: 4, jankPct: 1, styleLayoutMsPerS: 0.5 },
    save: { ok: true, blockMs: 30, busyMs: 90 },
    resize: { cpuMs: 15 },
    audio: { played: 3, kept: 4, bytes: 2 * 1024 * 1024 },
    heapBytes: 1024 * 1024,
    // 2 calls × 300 ns + 1 call × 0 (a negative difference is noise)
    hot: { "Input.update": 2, "Window_Message.prototype.update": 1, "Input.clear": 0.5 },
    overhead: { "Input.update": 300, "Window_Message.prototype.update": -40 },
  });
  assert.deepEqual(m, {
    hookUs: 0.6,
    bootMs: 600,
    walkUs: 20,
    messageUs: 5,
    frameCpuP50: 2,
    frameCpuP95: 4,
    jankPct: 1,
    styleLayoutMsPerS: 0.5,
    saveBlockMs: 30,
    saveBusyMs: 90,
    resizeMs: 15,
    audioKept: 4,
    audioMB: 2,
    heapMB: 1,
  });
  // A failed save or no audio played leaves those out.
  assert.deepEqual(metricsOf({ save: { ok: false, blockMs: 1 }, audio: { played: 0 } }), {});

  const c = combine([{ walkUs: 10 }, { walkUs: 14, bootMs: NaN }, { walkUs: 12 }]);
  assert.deepEqual(c, { walkUs: { median: 12, min: 10, max: 14, n: 3 } });
});

test("bench findings need the limit and to stand out from the noise", () => {
  const combined = {
    none: combine([{ walkUs: 100, audioMB: 1, resizeMs: 10 }, { walkUs: 104, audioMB: 1, resizeMs: 12 }]),
    "+Report": combine([{ walkUs: 102, audioMB: 90, resizeMs: 11 }, { walkUs: 101, audioMB: 91, resizeMs: 10 }]),
    "+MobileControls": combine([{ walkUs: 400, audioMB: 1, resizeMs: 80 }, { walkUs: 150, audioMB: 1, resizeMs: 82 }]),
  };
  const found = findings(combined);
  assert.deepEqual(
    found.map((f) => `${f.variant} ${f.metric}`),
    ["+Report audioMB", "+MobileControls resizeMs"] // walkUs: +171 but the variant's own spread is 250
  );

  const report = formatReport({
    combined,
    hooks: { RWK_Core: ["SceneManager.updateScene"], RWK_Dash: [] },
    hot: { "Input.update": 1, "Input.clear": 0.25 },
    overhead: { "Input.update": 120 },
    info: ["Game"],
  });
  assert.match(report, /^Game/);
  assert.match(report, /\+Report +.*90\.5 \(\+89\.5\) !/);
  assert.match(report, /Core: SceneManager\.updateScene/);
  assert.doesNotMatch(report, /Dash:/);
  assert.match(report, / 1\.00 +120 {2}Input\.update\n +0\.25 +– {2}Input\.clear/);
  assert.match(report, /Over the limit:\n {2}\+Report: Audio kept \+89\.5 MB/);
  assert.match(formatReport({ combined: { none: combined.none } }), /No variant differs/);
});
