// Takes the guide's screenshots into site/public/img/.
//
// The game is "GameDev: The Beginning" by yancharkin (CC BY-SA 4.0,
// https://yancharkin.itch.io/gamedev-the-beginning), published with the
// toolkit at GAME. Each shot loads it in Chrome with the toolkit's plugins
// swapped for runtime/ (so the shots show the current UI), the settings below,
// and a save API answered here instead of the Worker.
//
// Needs Playwright and Google Chrome (headless Chromium renders the game at a
// few frames per second), once in site/: `npm install --no-save playwright`.
// Then: `npm run screenshots`. Another web build: `$env:RWK_SHOT_GAME = "<url>"`.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createWorker } from "../../worker/index.js";

// require() so a global Playwright (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const GAME = process.env.RWK_SHOT_GAME || "https://gamedev-the-beginning.kokoroou.workers.dev/";
const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, "../../runtime");
const out = path.join(here, "../public/img");
fs.mkdirSync(out, { recursive: true });

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

// The game's settings, as config would show them after a first deploy
// with cloud saves on. The keys are the ones the game's plugins read (1-5).
const SETTINGS = {
  sync: { enabled: true },
  controls: {
    enabled: true,
    showOn: "touch",
    gamepad: true,
    dpad: true,
    opacity: 0.35,
    scale: 1,
    extras: ["fullscreen", "editLayout"],
    buttons: [
      { key: "one", label: "Items", hint: "Inventory" },
      { key: "two", label: "Equip", hint: "Equipment" },
      { key: "three", label: "Skills", hint: "Skills" },
      { key: "five", label: "Quickbar", hint: "Show or hide the quickbar" },
      { key: "four", label: "Candle", pin: true },
    ],
  },
};

// The save API, as the Worker would answer it.
const MIN = 60000;
const now = Date.now();
const PHONE = "Android-3f9a1c2e";
const PC = "Windows-7b20d4aa";
const REMOTE = {
  ok: [],
  conflict: [
    { name: "file1", etag: "a1", updatedAt: now - 2 * 60 * MIN, deviceId: PHONE },
    { name: "file2", etag: "b2", updatedAt: now - 26 * 60 * MIN, deviceId: PHONE },
  ],
  recent: [{ name: "file1", etag: "a1", updatedAt: now - 90000, deviceId: PHONE }],
};
const HISTORY = [
  { name: "file1", id: "1", updatedAt: now - 40 * MIN, deviceId: PHONE, size: 48300 },
  { name: "file1", id: "2", updatedAt: now - 26 * 60 * MIN, deviceId: PC, size: 47100 },
  { name: "file2", id: "3", updatedAt: now - 3 * 60 * MIN, deviceId: PC, size: 46800 },
  { name: "rwk-auto", id: "4", updatedAt: now - 20 * MIN, deviceId: PHONE, size: 48200 },
  { name: "rwk-auto", id: "5", updatedAt: now - 38 * MIN, deviceId: PHONE, size: 48100 },
];

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(viewport, { sync = "ok", localSaves = [] } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: "en-US",
    timezoneId: "UTC",
  });
  await context.route(/\/js\/plugins\/RWK_\w+\.js$/, (route) =>
    route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(runtime, path.basename(new URL(route.request().url()).pathname))) })
  );
  await context.route(/\/js\/plugins\.js$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/("name":"RWK_Core".*?"config":)("(?:[^"\\]|\\.)*")/, (_, head, str) => {
      const config = { ...JSON.parse(JSON.parse(str)), ...SETTINGS };
      return head + JSON.stringify(JSON.stringify(config));
    });
    await route.fulfill({ response: res, body });
  });
  await context.route(/\/api\//, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/api/saves" && req.method() === "GET") return route.fulfill(json({ items: REMOTE[sync] }));
    if (p === "/api/history") return route.fulfill(json({ items: HISTORY }));
    if (req.method() === "DELETE") return route.fulfill({ status: 204 });
    return route.fulfill(json({ etag: "e" + Math.random().toString(36).slice(2) }));
  });
  if (localSaves.length) {
    await context.addInitScript((names) => {
      for (const n of names) localStorage.setItem("RPG File" + n, "save");
    }, localSaves);
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(e.stack));
  await page.goto(GAME);
  return page;
}

// The engine reads keys once per frame: hold them a little.
async function press(page, key) {
  await page.keyboard.down(key);
  await page.waitForTimeout(120);
  await page.keyboard.up(key);
}

// From the title screen to the kitchen, next to Joe's mother (map 4), facing her.
async function play(page) {
  await page.waitForFunction(() => window.SceneManager && SceneManager._sceneStarted && SceneManager._scene instanceof Scene_Title, null, { timeout: 90000 });
  while (await page.evaluate(() => SceneManager._scene._pressStart)) await press(page, "Enter");
  await page.evaluate(() => {
    DataManager.setupNewGame();
    $gamePlayer.reserveTransfer(4, 3, 4, 8, 0);
    SceneManager.goto(Scene_Map);
  });
  await page.waitForFunction(
    () => SceneManager._scene instanceof Scene_Map && SceneManager._sceneStarted && $gameMap.mapId() === 4 && !$gameMap.isEventRunning() && !$gamePlayer.isTransferring(),
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => {
    const mother = $gameMap.event(4);
    mother._moveType = 0; // she wanders otherwise
    mother.locate(3, 3);
    mother.setDirection(2);
    // Headless Chrome may stall the controls' wait for the canvas: lay out again.
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(1500); // fade in
}

async function talk(page) {
  for (let i = 0; i < 20 && !(await page.evaluate(() => $gameMessage.isBusy())); i++) {
    await press(page, "Enter");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1500); // the text types out
}

// The controls fade while the player only watches; show them at full opacity.
const wake = (page) => page.evaluate(() => document.querySelector(".rwk-pad").classList.remove("idle"));

// bindPress listens to pointer events; a mouse click sends them.
const tap = (page, selector) => page.click(selector);
const openTool = async (page, label) => {
  await tap(page, ".rwk-tool-menu");
  await page.click(`.rwk-tools-list button:has(:text-is("${label}"))`);
};

async function shot(name, viewport, act, options) {
  const page = await open(viewport, options);
  await act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, name + ".png") });
  await page.context().close();
  console.log("✓", name);
}

const talking = async (p) => {
  await play(p);
  await talk(p);
  await wake(p);
};
await shot("controls-landscape", LANDSCAPE, talking);
await shot("controls-portrait", PORTRAIT, talking);
await shot("game-keys", PORTRAIT, async (p) => {
  await play(p);
  await tap(p, ".rwk-tool-keys");
});
await shot("tools-menu", PORTRAIT, async (p) => {
  await play(p);
  await tap(p, ".rwk-tool-menu");
});
await shot("edit-layout", LANDSCAPE, async (p) => {
  await play(p);
  await openTool(p, "Edit button layout");
  // Hide L, as a player who never uses it would (each button's badge follows it).
  await p.click(".rwk-shoulder + .rwk-badge");
  await p.waitForTimeout(5200); // let the help toast fade
});
await shot("saves-panel", PORTRAIT, async (p) => {
  await play(p);
  await p.evaluate(() => {
    for (const id of [1, 2, 4]) {
      $gameSystem.onBeforeSave();
      DataManager.saveGame(id);
    }
  });
  await p.waitForTimeout(2500); // the uploads' toasts
  await openTool(p, "Saves");
});
await shot("save-history", PORTRAIT, async (p) => {
  await play(p);
  await openTool(p, "Older saves");
});
const conflict = (p) => p.waitForSelector(".rwk-modal", { timeout: 90000 });
await shot("sync-conflict", PORTRAIT, conflict, { sync: "conflict", localSaves: [1, 2] });
await shot("sync-recent", PORTRAIT, conflict, { sync: "recent" });
await shot("item-batch", LANDSCAPE, async (p) => {
  await play(p);
  await p.evaluate(() => {
    $gameParty.gainItem($dataItems[1], 12); // Red Berry
    $gameParty.leader().addParam(0, 300); // room for 10 berries
    $gameParty.leader().setHp(1);
    SceneManager.push(Scene_Item);
  });
  await p.waitForFunction(() => SceneManager._scene instanceof Scene_Item && SceneManager._sceneStarted);
  await p.evaluate(() => {
    const list = SceneManager._scene._itemWindow;
    list.select(list._data.indexOf($dataItems[1]));
  });
  await press(p, "Enter");
  await p.waitForTimeout(800);
  const count = () => p.evaluate(() => SceneManager._scene._windowLayer.children.find((w) => w instanceof Window_ShopNumber)._number);
  for (let i = 0; i < 20 && (await count()) < 10; i++) await press(p, "ArrowRight");
});

// The page every visitor gets until Access is set up, from the Worker itself.
{
  const res = await createWorker().fetch(new Request("https://gamedev-the-beginning.myname.workers.dev/"), { RWK_LOCKED: "1" });
  const context = await browser.newContext({ viewport: { width: 720, height: 360 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(await res.text());
  await page.screenshot({ path: path.join(out, "locked-page.png") });
  await context.close();
  console.log("✓ locked-page");
}

// A first deploy in PowerShell.
{
  const context = await browser.newContext({ viewport: { width: 1020, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(here, "terminal.html")).href);
  await page.locator(".win").screenshot({ path: path.join(out, "first-deploy.png") });
  await context.close();
  console.log("✓ first-deploy");
}

await browser.close();
