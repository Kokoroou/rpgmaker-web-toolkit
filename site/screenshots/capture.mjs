// Takes the guide's screenshots into site/public/img/.
// Needs Playwright, once: `npm install --no-save playwright && npx playwright install chromium`
// in site/. Then: `npm run screenshots`.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createWorker } from "../../worker/index.js";

// require() so a global Playwright (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../public/img");
fs.mkdirSync(out, { recursive: true });
const sim = pathToFileURL(path.join(here, "simulator.html")).href;

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const browser = await chromium.launch();

async function shot(name, { viewport = PORTRAIT, query = "", touch = true, act, clip } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    hasTouch: touch,
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(name, e));
  await page.goto(`${sim}?${query}`);
  await page.waitForTimeout(300);
  if (act) await act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, name + ".png"), clip });
  await context.close();
  console.log("✓", name);
}

// bindPress listens to pointer events; a mouse click sends them.
const tap = (page, selector) => page.click(selector);
const openTool = async (page, label) => {
  await tap(page, ".rwk-tool-more");
  await page.click(`.rwk-tools-list button:has-text("${label}")`);
};

await shot("controls-portrait");
await shot("controls-landscape", { viewport: LANDSCAPE });
await shot("game-keys", { act: (p) => tap(p, ".rwk-tool-keys") });
await shot("tools-menu", { act: (p) => tap(p, ".rwk-tool-more") });
await shot("edit-layout", {
  viewport: LANDSCAPE,
  act: async (p) => {
    await openTool(p, "Edit button layout");
    // Hide L, as a player who never uses it would (each button's badge follows it).
    await p.click(".rwk-shoulder + .rwk-badge");
    await p.waitForTimeout(5200); // let the help toast fade
  },
});
await shot("saves-panel", { act: (p) => openTool(p, "Saves") });
await shot("sync-conflict", { query: "sync=conflict", act: (p) => p.waitForSelector(".rwk-modal") });
await shot("sync-recent", { query: "sync=recent", act: (p) => p.waitForSelector(".rwk-modal") });
await shot("item-batch", { viewport: LANDSCAPE, query: "scene=items" });

// The page every visitor gets until Access is set up, from the Worker itself.
{
  const res = await createWorker().fetch(new Request("https://moonlit-ferry.myname.workers.dev/"), { RWK_LOCKED: "1" });
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
