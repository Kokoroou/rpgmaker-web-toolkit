// Pure parts of the runtime benchmark: which plugin sets to measure, the
// statistics and the report. Tested in test/perf.test.js.

export const short = (name) => name.replace(/^RWK_/, "");

// The numbers kept from each run. limit: a difference from the run without
// the toolkit ("none") above this counts as a real cost. A frame is 16.7 ms at
// 60 fps and a mid-range phone runs scripts about 4x slower than a desktop,
// so 100 µs of logic per frame on a desktop is ~2.5 % of a phone's frame.
export const METRICS = [
  { key: "hookUs", label: "Hooks, same page", unit: "µs/frame", group: "frame", limit: 100 },
  { key: "walkUs", label: "Logic, walking", unit: "µs/frame", group: "frame", limit: 100 },
  { key: "messageUs", label: "Logic, messages", unit: "µs/frame", group: "frame", limit: 100 },
  { key: "frameCpuP50", label: "Frame CPU p50", unit: "ms", group: "frame", limit: 0.5 },
  { key: "frameCpuP95", label: "Frame CPU p95", unit: "ms", group: "frame", limit: 1 },
  { key: "jankPct", label: "Frames >20ms", unit: "%", group: "frame", limit: 2 },
  { key: "styleLayoutMsPerS", label: "Style+layout", unit: "ms/s", group: "frame", limit: 5 },
  { key: "bootMs", label: "Boot", unit: "ms", group: "event", limit: 300 },
  { key: "saveBlockMs", label: "Save blocks", unit: "ms", group: "event", limit: 16 },
  { key: "saveBusyMs", label: "Save+upload CPU", unit: "ms", group: "event", limit: 50 },
  { key: "resizeMs", label: "4 rotations CPU", unit: "ms", group: "event", limit: 50 },
  { key: "audioKept", label: "Audio kept", unit: "objects", group: "memory", limit: 3 },
  { key: "audioMB", label: "Audio kept", unit: "MB", group: "memory", limit: 10 },
  { key: "heapMB", label: "JS heap", unit: "MB", group: "memory", limit: 10 },
];

const GROUPS = [
  ["frame", "Every frame"],
  ["event", "Once in a while"],
  ["memory", "Memory after playing audio, after GC"],
];

// spec: comma-separated
//   none   no toolkit plugin (always measured: the baseline)
//   all    every plugin, as deployed
//   core   RWK_Core alone
//   each   RWK_Core + one plugin, for every plugin
//   +Name  RWK_Core + Name        -Name  every plugin but Name
// plugins: in load order, RWK_Core first.
export function parseVariants(spec, plugins) {
  const core = plugins[0];
  const find = (n) => {
    const name = plugins.find((p) => p.toLowerCase() === n.toLowerCase() || short(p).toLowerCase() === n.toLowerCase());
    if (!name) throw new Error(`Unknown plugin "${n}". Plugins: ${plugins.map(short).join(", ")}`);
    return name;
  };
  const out = [];
  const add = (id, list) => {
    if (!out.some((v) => v.id === id)) out.push({ id, plugins: list });
  };
  for (const item of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    if (item === "none") add("none", []);
    else if (item === "all") add("all", [...plugins]);
    else if (item === "core") add("core", [core]);
    else if (item === "each") for (const p of plugins.slice(1)) add("+" + short(p), [core, p]);
    else if (item[0] === "+") {
      const p = find(item.slice(1));
      add(p === core ? "core" : "+" + short(p), p === core ? [core] : [core, p]);
    } else if (item[0] === "-") {
      const p = find(item.slice(1));
      if (p === core) throw new Error(`${core} cannot be left out: every other plugin needs it.`);
      add("-" + short(p), plugins.filter((x) => x !== p));
    } else throw new Error(`Unknown variant "${item}" (none, all, core, each, +Name, -Name).`);
  }
  if (!out.some((v) => v.id === "none")) out.unshift({ id: "none", plugins: [] });
  return out;
}

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MB = 1024 * 1024;

// µs per frame the hooks add: ns per call (overhead) × calls per frame (hot).
// Below-zero differences are timing noise and count as 0.
export function hookCost(hot, overhead) {
  let ns = 0;
  for (const [label, perFrame] of Object.entries(hot)) ns += Math.max(0, overhead[label] || 0) * perFrame;
  return ns / 1000;
}

// One run's scenario results (see bench.js) -> { metricKey: number }
export function metricsOf(raw) {
  const m = {};
  if (raw.boot) m.bootMs = raw.boot.bootMs;
  if (raw.hot && raw.overhead) m.hookUs = hookCost(raw.hot, raw.overhead);
  if (raw.walk) m.walkUs = median(raw.walk.samples);
  if (raw.message) m.messageUs = median(raw.message.samples);
  if (raw.realtime) {
    m.frameCpuP50 = raw.realtime.cpuP50;
    m.frameCpuP95 = raw.realtime.cpuP95;
    m.jankPct = raw.realtime.jankPct;
    m.styleLayoutMsPerS = raw.realtime.styleLayoutMsPerS;
  }
  if (raw.save && raw.save.ok) {
    m.saveBlockMs = raw.save.blockMs;
    m.saveBusyMs = raw.save.busyMs;
  }
  if (raw.resize) m.resizeMs = raw.resize.cpuMs;
  if (raw.audio && raw.audio.played) {
    m.audioKept = raw.audio.kept;
    m.audioMB = raw.audio.bytes / MB;
  }
  if (raw.heapBytes) m.heapMB = raw.heapBytes / MB;
  return m;
}

// Runs of one variant -> { metricKey: { median, min, max, n } }
export function combine(runs) {
  const out = {};
  for (const { key } of METRICS) {
    const values = runs.map((r) => r[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (values.length) out[key] = { median: median(values), min: Math.min(...values), max: Math.max(...values), n: values.length };
  }
  return out;
}

// Differences from "none" that pass the metric's limit and stand out from the
// noise (twice the spread of "none" across rounds, or of the variant itself).
export function findings(combined) {
  const base = combined.none || {};
  const out = [];
  for (const [id, metrics] of Object.entries(combined)) {
    if (id === "none") continue;
    for (const def of METRICS) {
      const v = metrics[def.key];
      const b = base[def.key];
      if (!v || !b) continue;
      const delta = v.median - b.median;
      const noise = 2 * Math.max(b.max - b.min, v.max - v.min);
      if (delta > def.limit && delta > noise) out.push({ variant: id, metric: def.key, label: def.label, unit: def.unit, delta, noise, limit: def.limit });
    }
  }
  return out.sort((a, b) => b.delta / b.limit - a.delta / a.limit);
}

export function fmt(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => (i ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join("  ")).join("\n");
}

// combined: { variantId: combine(...) } in variant order; hooks: { RWK_X: [...] };
// hot: { label: calls per frame }; overhead: { label: ns per call }; info: header lines.
export function formatReport({ combined, hooks = {}, hot = {}, overhead = {}, info = [] }) {
  const base = combined.none || {};
  const flagged = new Set(findings(combined).map((f) => f.variant + " " + f.metric));
  const lines = [...info, ""];

  for (const [group, title] of GROUPS) {
    const defs = METRICS.filter((d) => d.group === group && Object.values(combined).some((c) => c[d.key]));
    if (!defs.length) continue;
    const rows = [["variant", ...defs.map((d) => `${d.label} (${d.unit})`)]];
    for (const [id, metrics] of Object.entries(combined)) {
      rows.push([
        id,
        ...defs.map((d) => {
          const v = metrics[d.key];
          if (!v) return "–";
          if (id === "none" || !base[d.key]) return fmt(v.median) + (v.n > 1 ? ` ±${fmt((v.max - v.min) / 2)}` : "");
          const delta = v.median - base[d.key].median;
          return `${fmt(v.median)} (${delta >= 0 ? "+" : ""}${fmt(delta)})${flagged.has(id + " " + d.key) ? " !" : ""}`;
        }),
      ]);
    }
    lines.push(`${title}: median of the rounds, (difference from none), ! = over the limit`, table(rows), "");
  }

  const hookLines = Object.entries(hooks).filter(([, list]) => list.length);
  if (hookLines.length) {
    lines.push("Engine functions each plugin replaces:");
    for (const [plugin, list] of hookLines) lines.push(`  ${short(plugin)}: ${list.join(", ")}`);
    lines.push("");
  }
  const hotList = Object.entries(hot).sort((a, b) => b[1] - a[1]);
  if (hotList.length) {
    lines.push("Hooks called during play (walking + messages), and what a call adds over the engine's own function:");
    lines.push("  calls/frame   ns/call  function");
    for (const [label, n] of hotList) {
      lines.push(`  ${fmt(n).padStart(11)}  ${(label in overhead ? fmt(overhead[label]) : "–").padStart(8)}  ${label}`);
    }
    lines.push("");
  }

  const found = findings(combined);
  if (found.length) {
    lines.push("Over the limit:");
    for (const f of found) {
      lines.push(`  ${f.variant}: ${f.label} +${fmt(f.delta)} ${f.unit} (limit ${fmt(f.limit)}, noise ${fmt(f.noise)})`);
    }
  } else lines.push("No variant differs from none by more than a metric's limit.");
  return lines.join("\n");
}
