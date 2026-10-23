import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  BUILD_DIR,
  DEFAULT_BUCKET,
  TOOLKIT_ROOT,
  findGameConfig,
  gameConfigExists,
  loadSettings,
  saveGameConfig,
  saveSettings,
} from "../lib/config.js";
import {
  deployWorker,
  ensureBucket,
  ensureLogin,
  importSaves,
  listSaveFiles,
  probeAccess,
  syncOverflow,
  writeWorkerProject,
} from "../lib/cloudflare.js";
import { MAX_ASSET_BYTES, MAX_ASSET_FILES, analyzeGame, collectFiles, suggestSlug, validateSlug } from "../lib/game.js";
import { defaultLabel, scanKeys } from "../lib/keys.js";
import { generatedFiles, syncPublicDir } from "../lib/stage.js";
import { ask, c, choose, confirm, formatBytes, log, pause } from "../lib/ui.js";

export async function deploy(inputPath, { importOnly = false } = {}) {
  if (!inputPath) inputPath = await ask("Kéo thả hoặc dán đường dẫn thư mục game");
  inputPath = inputPath.replace(/^["']|["']$/g, "");

  //-------------------------------------------------------------------------
  log.step("Phân tích game");
  const game = analyzeGame(inputPath);
  log.ok(`${game.engine} · ${game.title}`);
  log.info(c.dim(game.root));
  if (game.engine === "MV") log.warn("Game MV: adapter đã có nhưng chưa được kiểm thử thực tế.");

  const settings = loadSettings();
  let cfg = findGameConfig(game.fingerprint);
  if (cfg) {
    log.ok(`Dùng cấu hình đã lưu: games/${cfg.slug}.json`);
  } else {
    log.info("Lần đầu deploy game này: trả lời vài câu hỏi (Enter = dùng giá trị mặc định).");
    cfg = await createConfig(game);
  }
  await addNewKeys(game, cfg);
  saveGameConfig(cfg);

  if (importOnly) {
    const { email } = await connect(settings);
    await offerSaveImport(game, cfg, settings.bucket, email, true);
    saveGameConfig(cfg);
    return;
  }

  //-------------------------------------------------------------------------
  log.step("Chuẩn bị bản web");
  const buildDir = path.join(BUILD_DIR, cfg.slug);
  const files = collectFiles(game, cfg);
  const overflow = files.filter((f) => f.size > MAX_ASSET_BYTES);
  const assets = files.filter((f) => f.size <= MAX_ASSET_BYTES);
  const generated = generatedFiles(game, cfg);
  const assetCount = new Set([...assets.map((f) => f.rel), ...generated.keys()]).size;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(`${files.length} file, ${formatBytes(totalBytes)} (${overflow.length} file > 25 MiB sẽ nằm trên R2)`);
  if (assetCount > MAX_ASSET_FILES) throw tooManyFiles(assets, assetCount);

  const stats = syncPublicDir(path.join(buildDir, "public"), assets, generated);
  log.ok(`Đã dựng .build/${cfg.slug}/public (mới ${stats.linked + stats.copied}, giữ ${stats.unchanged}, xoá ${stats.removed})`);
  if (stats.copied) log.info(c.dim("Game và toolkit khác ổ đĩa nên phải copy thay vì hard link; lần sau chỉ copy file thay đổi."));

  const { email, account } = await connect(settings);

  //-------------------------------------------------------------------------
  const needBucket = overflow.length > 0 || cfg.sync.enabled;
  if (needBucket) {
    log.step("R2");
    await ensureBucket(settings.bucket, account.id);
    const cacheFile = path.join(buildDir, "hash-cache.json");
    const hashCache = readJson(cacheFile) || {};
    const res = await syncOverflow({ bucket: settings.bucket, slug: cfg.slug, files: overflow, hashCache });
    fs.writeFileSync(cacheFile, JSON.stringify(hashCache));
    log.ok(`File lớn trên R2: tải lên ${res.uploaded}, không đổi ${res.unchanged}, xoá ${res.removed}`);
  }

  //-------------------------------------------------------------------------
  log.step("Deploy Worker (wrangler chỉ tải lên file đã thay đổi)");
  const project = {
    buildDir,
    slug: cfg.slug,
    bucket: needBucket ? settings.bucket : null,
    overflowRels: overflow.map((f) => f.rel),
    toolkitRoot: TOOLKIT_ROOT,
  };
  const authReady = isAuthReady(cfg.auth);
  let url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: !authReady }));
  if (url) cfg.url = url;
  saveGameConfig(cfg);

  if (!authReady) {
    await setupAuth(cfg, account);
    saveGameConfig(cfg);
    if (isAuthReady(cfg.auth)) {
      log.step("Deploy lại với bảo vệ truy cập");
      url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: false }));
    } else {
      log.warn("Trang vẫn đang khoá. Chạy lại lệnh này khi muốn hoàn tất bước bảo vệ truy cập.");
    }
  } else if (cfg.auth.mode === "access" && cfg.url) {
    const probe = await probeAccess(cfg.url);
    if (probe.protected) log.ok("Cloudflare Access đang bảo vệ trang");
    else log.warn(c.yellow("Cloudflare Access KHÔNG còn bảo vệ trang! Kiểm tra lại trong dashboard (Worker → Settings → Domains & Routes)."));
  }

  //-------------------------------------------------------------------------
  if (cfg.sync.enabled && isAuthReady(cfg.auth)) await offerSaveImport(game, cfg, settings.bucket, email, false);
  saveGameConfig(cfg);

  console.log(`\n${c.green("Hoàn tất!")} ${cfg.url ? c.bold(cfg.url) : ""}`);
  log.info(`Cấu hình: games/${cfg.slug}.json. Hãy commit & push để máy khác dùng lại (git add games && git commit && git push).`);
  log.info("Điện thoại: mở link → menu trình duyệt → “Thêm vào màn hình chính” để chơi toàn màn hình.");
}

async function connect(settings) {
  log.step("Cloudflare");
  const session = await ensureLogin(settings);
  settings.bucket = settings.bucket || DEFAULT_BUCKET;
  saveSettings(settings);
  log.ok(`Account: ${session.account.name}`);
  return session;
}

function isAuthReady(auth = {}) {
  return auth.mode === "none" || (auth.mode === "access" && !!auth.teamDomain && !!auth.aud);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function tooManyFiles(assets, count) {
  const byTop = new Map();
  for (const f of assets) {
    const top = f.rel.split("/")[0];
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const lines = [...byTop].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `    ${dir}: ${n}`);
  return new Error(
    `Bản web có ${count} file, vượt giới hạn ${MAX_ASSET_FILES} của Workers (gói free).\n` +
      `${lines.join("\n")}\nThêm mẫu loại trừ vào "exclude" trong games/<slug>.json (ví dụ "data-tw/**") rồi chạy lại.`
  );
}

//---------------------------------------------------------------------------
// First-run questions
//---------------------------------------------------------------------------

async function createConfig(game) {
  const slug = await ask("Tên web (sẽ thành <tên>.<username>.workers.dev)", suggestSlug(game), (v) => {
    const problem = validateSlug(v);
    if (problem) return problem;
    return gameConfigExists(v) ? `games/${v}.json đã dùng cho game khác, chọn tên khác.` : null;
  });

  const include = [];
  if (game.unknownDirs.length) {
    log.info(`Thư mục lạ ở gốc game (không thuộc cấu trúc RPG Maker chuẩn): ${game.unknownDirs.join(", ")}`);
    for (const dir of game.unknownDirs) {
      if (await confirm(`Đưa "${dir}" lên web? (chọn có nếu plugin của game đọc file trong đó)`, false)) include.push(dir);
    }
  }

  const syncEnabled = await confirm("Bật đồng bộ save qua cloud (chơi tiếp trên nhiều máy)?", true);

  const cfg = {
    slug,
    title: game.title,
    engine: game.engine,
    fingerprint: game.fingerprint,
    include,
    exclude: [],
    sync: { enabled: syncEnabled },
    auth: {},
    controls: { enabled: false, showOn: "touch", dpad: false, opacity: 0.5, scale: 1, buttons: [], scannedKeys: [] },
  };

  const keys = scanKeys(game.root);
  cfg.controls.scannedKeys = keys.map((k) => k.key);
  if (keys.length) {
    log.info("Plugin của game dùng các phím mà điện thoại không bấm được:");
    for (const k of keys) log.info(`    ${c.bold(k.key.padEnd(10))} ${c.dim(k.plugins.join(", "))}`);
  } else {
    log.info("Không thấy plugin nào dùng phím đặc biệt.");
  }
  if (await confirm("Tạo nút ảo trên màn hình cảm ứng?", keys.length > 0)) {
    cfg.controls.enabled = true;
    cfg.controls.buttons = await askButtons(keys);
    if (!cfg.controls.buttons.some((b) => b.key === "escape")) {
      if (await confirm('Thêm nút "Menu" (phím Esc)?', true)) cfg.controls.buttons.push({ key: "escape", label: "Menu" });
    }
    cfg.controls.dpad = await confirm("Thêm D-pad (4 nút hướng)? MZ/MV đã có chạm để di chuyển", false);
    log.info(c.dim(`Có thể chỉnh nhãn, nhóm nút, cỡ, độ mờ trong games/${slug}.json; trong game có nút ✥ để kéo đổi vị trí.`));
  }
  return cfg;
}

async function askButtons(keys) {
  const buttons = [];
  if (keys.length) log.info(c.dim('Đặt nhãn cho từng nút: Enter = mặc định, "-" = bỏ qua phím này.'));
  for (const k of keys) {
    const label = await ask(`Nhãn nút cho phím "${k.key}"`, defaultLabel(k.key));
    if (label !== "-") buttons.push({ key: k.key, label });
  }
  return buttons;
}

// After a game patch, plugins may use new keys: offer buttons for those only.
async function addNewKeys(game, cfg) {
  const controls = cfg.controls;
  if (!controls) return;
  const known = new Set(controls.scannedKeys || []);
  const fresh = scanKeys(game.root).filter((k) => !known.has(k.key));
  if (!fresh.length) return;
  controls.scannedKeys = [...known, ...fresh.map((k) => k.key)];
  log.info(`Bản game mới dùng thêm phím: ${fresh.map((k) => k.key).join(", ")}`);
  if (controls.enabled && (await confirm("Thêm nút ảo cho các phím này?", true))) {
    controls.buttons.push(...(await askButtons(fresh)));
  }
}

//---------------------------------------------------------------------------
// Access protection
//---------------------------------------------------------------------------

async function setupAuth(cfg, account) {
  log.step("Bảo vệ truy cập");
  log.info("Trang đang tạm khoá. Chọn cách bảo vệ:");
  const mode = await choose("Phương án", [
    { label: "Cloudflare Access: đăng nhập bằng email, save gắn với email (khuyên dùng)", value: "access" },
    { label: "Không bảo vệ: ai có link cũng chơi được và dùng chung save", value: "none" },
    { label: "Để sau (giữ trang khoá)", value: "later" },
  ]);
  if (mode === "later") return;
  if (mode === "none") {
    if (await confirm("Chắc chắn để trang công khai?", false)) cfg.auth = { mode: "none" };
    return;
  }

  if (!cfg.url) cfg.url = await ask("URL của Worker (https://<tên>.<username>.workers.dev)");
  const dash = `https://dash.cloudflare.com/${account.id}/workers/services/view/${cfg.slug}/production/settings`;
  log.info("Làm theo các bước sau trong trình duyệt (đang mở trang Settings của Worker):");
  log.info(`  1. Mục ${c.bold("Domains & Routes")} → dòng ${c.bold("workers.dev")} → bật ${c.bold("Cloudflare Access")}.`);
  log.info("  2. Nếu lần đầu dùng Zero Trust: đặt tên team và chọn gói Free.");
  log.info("  3. Mặc định chỉ email của tài khoản Cloudflare được vào. Muốn thêm email khác:");
  log.info("     Zero Trust → Access → Applications → app của Worker → Policies.");
  log.info(c.dim(`  ${dash}`));
  openBrowser(dash);

  for (;;) {
    await pause("Bật xong thì nhấn Enter để kiểm tra…");
    const probe = await probeAccess(cfg.url);
    if (probe.protected && probe.aud) {
      cfg.auth = { mode: "access", teamDomain: probe.teamDomain, aud: probe.aud };
      log.ok(`Đã nhận Access: ${probe.teamDomain}`);
      return;
    }
    log.warn(probe.error ? `Không truy cập được trang: ${probe.error}` : "Trang chưa được Access bảo vệ (thay đổi có thể mất ~1 phút).");
    const next = await choose("Tiếp theo", [
      { label: "Kiểm tra lại", value: "retry" },
      { label: "Tự nhập Team domain và AUD", value: "manual" },
      { label: "Để sau (giữ trang khoá)", value: "later" },
    ]);
    if (next === "later") return;
    if (next === "manual") {
      const teamDomain = await ask("Team domain (vd: tenteam.cloudflareaccess.com)", "", (v) =>
        /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v) ? null : "Dạng <team>.cloudflareaccess.com"
      );
      const aud = await ask("Application Audience (AUD) tag", "", (v) => (/^[a-f0-9]{32,}$/i.test(v) ? null : "AUD là chuỗi hex dài"));
      cfg.auth = { mode: "access", teamDomain: teamDomain.toLowerCase(), aud };
      return;
    }
  }
}

function openBrowser(url) {
  try {
    spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The URL is printed anyway.
  }
}

//---------------------------------------------------------------------------
// Save import
//---------------------------------------------------------------------------

async function offerSaveImport(game, cfg, bucket, accountEmail, force) {
  if (!cfg.sync.enabled) {
    log.warn("Game này không bật đồng bộ save.");
    return;
  }
  if (!force && cfg.savesImportedAt) return;
  if (!game.saveDir) {
    if (force) log.warn("Không thấy thư mục save/ trong game.");
    return;
  }
  const saves = listSaveFiles(game.saveDir, game.engine);
  if (!saves.length) return;

  log.step("Save trên máy");
  log.info(`Có ${saves.length} save trong ${game.saveDir}: ${saves.map((s) => s.name).join(", ")}`);
  if (!(await confirm("Tải các save này lên cloud? (ghi đè save cùng tên trên cloud)", !cfg.savesImportedAt))) {
    if (!force) cfg.savesImportedAt = "skipped";
    return;
  }
  const email =
    cfg.auth.mode === "none"
      ? "public"
      : await ask("Email bạn dùng để đăng nhập Cloudflare Access", accountEmail || "", (v) => (/.+@.+/.test(v) ? null : "Email không hợp lệ"));
  const count = await importSaves({ bucket, slug: cfg.slug, email, saves });
  cfg.savesImportedAt = new Date().toISOString();
  log.ok(`Đã tải ${count} save lên cloud`);
}
