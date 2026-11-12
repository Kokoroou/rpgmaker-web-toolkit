// Several sites for one game (cli/lib/sites.js): deploy --new-site, and which site
// a command from the game folder works on.

import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandLine } from "../cli/lib/args.js";
import { list } from "../cli/commands/site.js";
import { takenNames } from "../cli/lib/game.js";
import { newSiteKey, publishedSiteOf, siteKey, siteOfFolder, sitesOfGame } from "../cli/lib/sites.js";
import { NeedsAnswer, setQuiet, setUnattended, warnings } from "../cli/lib/ui.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });
const game = { fingerprint: "mz:1" };
const v1 = { slug: "game1v1", fingerprint: "mz:1", url: "https://game1v1.me.workers.dev" };
const v2 = { slug: "game1v2", fingerprint: "mz:1" };
const other = { slug: "other", fingerprint: "mv:2" };
const two = { "mz:1": v1, [siteKey("mz:1", "game1v2")]: v2, "mv:2": other };
const quietly = (t) => {
  setQuiet(true);
  t.after(() => setQuiet(false));
};
const unattended = (t) => {
  setUnattended(true);
  t.after(() => setUnattended(false));
};

test("--new-site: a deploy switch only; --name picks the site of rename and saves import too", () => {
  assert.equal(parse(["deploy", "g", "--new-site", "--name", "v2"]).flags.newSite, true);
  assert.equal(parse(["deploy", "g"]).flags.newSite, false);
  assert.throws(() => parse(["upgrade", "g", "--new-site"]), (err) => err.exitCode === 64 && /Unknown option --new-site/.test(err.message));
  assert.equal(parse(["rename", "g", "--name", "game1v2", "--to", "game1v3"]).flags.name, "game1v2");
  assert.equal(parse(["saves", "import", "g", "--name", "game1v2"]).flags.name, "game1v2");
});

test("sitesOfGame: the first site first, then the others by name; another game's keys are not its", () => {
  const configs = { ...two, "mz:1@x": { slug: "lookalike", fingerprint: "mz:1@x" }, [siteKey("mz:1", "a")]: { slug: "a-site", fingerprint: "mz:1" } };
  assert.deepEqual(
    sitesOfGame(configs, "mz:1").map(([, cfg]) => cfg.slug),
    ["game1v1", "a-site", "game1v2"]
  );
  assert.deepEqual(sitesOfGame({}, "mz:1"), []);
  assert.equal(newSiteKey({}, "mz:1", "game1v1"), "mz:1", "the first site keeps the game's key");
  assert.equal(newSiteKey(two, "mz:1", "game1v3"), "mz:1@game1v3");
});

test("takenNames: a new site may not take a name of the game's own sites", () => {
  const taken = takenNames(two, null);
  for (const name of ["game1v1", "game1v2", "other"]) assert.ok(taken.has(name), name);
  assert.ok(!takenNames(two, "mz:1@game1v2").has("game1v2"), "a site's own name is its own");
  assert.ok(takenNames(two, "mz:1@game1v2").has("game1v1"));
});

test("siteOfFolder: a game with one site, as before", async (t) => {
  quietly(t);
  const one = { "mz:1": v1 };
  assert.deepEqual(await siteOfFolder({}, game, { name: "fresh" }), { key: null, cfg: null, name: "fresh" }, "first deploy");
  assert.deepEqual(await siteOfFolder({}, game, { project: { name: "from-file" } }), { key: null, cfg: null, name: "from-file" });
  assert.equal((await siteOfFolder(one, game, {})).cfg, v1);
  assert.equal((await siteOfFolder(one, game, { name: "game1v1" })).key, "mz:1");
  await assert.rejects(
    siteOfFolder(one, game, { name: "game1v2", folder: "D:\\G" }),
    (err) => /already published as "game1v1", not "game1v2"/.test(err.message) && /rwk rename "D:\\G" --to game1v2/.test(err.hint) && /--new-site --name game1v2/.test(err.hint)
  );
  const before = warnings.length;
  assert.equal((await siteOfFolder(one, game, { project: { name: "renamed" } })).cfg, v1, "rwk.json that disagrees only warns");
  assert.match(warnings.at(-1), /says "renamed", but this game is published as "game1v1"/);
  assert.ok(warnings.length > before);
});

test("siteOfFolder: --new-site adds a site, never one of the game's names", async (t) => {
  quietly(t);
  assert.deepEqual(await siteOfFolder(two, game, { newSite: true, name: "game1v3" }), { key: null, cfg: null, name: "game1v3" });
  assert.deepEqual(await siteOfFolder(two, game, { newSite: true }), { key: null, cfg: null, name: undefined }, "no name: the question");
  assert.equal((await siteOfFolder(two, game, { newSite: true, project: { name: "game1v3" } })).name, "game1v3");
  assert.equal((await siteOfFolder(two, game, { newSite: true, project: { name: "game1v1" } })).name, undefined, "rwk.json naming a site it has: asked");
  await assert.rejects(siteOfFolder(two, game, { newSite: true, name: "game1v2" }), /"game1v2" is already a site of this game/);
  assert.deepEqual(await siteOfFolder({}, game, { newSite: true, name: "x" }), { key: null, cfg: null, name: "x" }, "an unpublished game: its first site");
});

test("siteOfFolder: several sites: --name, else rwk.json, else the question", async (t) => {
  quietly(t);
  assert.deepEqual(await siteOfFolder(two, game, { name: "game1v2" }), { key: "mz:1@game1v2", cfg: v2, name: "game1v2" });
  assert.equal((await siteOfFolder(two, game, { project: { name: "game1v2" } })).cfg, v2);
  await assert.rejects(siteOfFolder(two, game, { name: "nope" }), (err) => /published as "game1v1", "game1v2", not "nope"/.test(err.message) && /--new-site --name nope/.test(err.hint));

  let asked;
  const question = async (text, options) => {
    asked = { text, labels: options.map((o) => o.label) };
    return options[1].value;
  };
  assert.equal((await siteOfFolder(two, game, { question })).cfg, v2, "in a terminal: the question");
  assert.deepEqual(asked, { text: "This game has 2 sites. Which one?", labels: ["game1v1  https://game1v1.me.workers.dev", "game1v2"] });

  unattended(t);
  await assert.rejects(siteOfFolder(two, game, {}), (err) => err instanceof NeedsAnswer && /--name <site name>/.test(err.hint));
  await assert.rejects(siteOfFolder(two, game, { project: { name: "nope" } }), NeedsAnswer, "rwk.json naming none of them: the question");
  await assert.rejects(publishedSiteOf(two, game, { folder: "g", command: "upgrade" }), (err) => err instanceof NeedsAnswer && /rwk upgrade <site name>/.test(err.hint));
});

test("publishedSiteOf: the site's key and config, or not published", async (t) => {
  quietly(t);
  assert.deepEqual(await publishedSiteOf(two, game, { project: { name: "game1v2" }, folder: "g", command: "config" }), ["mz:1@game1v2", v2]);
  await assert.rejects(publishedSiteOf({}, game, { folder: "D:\\G", command: "config" }), (err) => /no settings to edit/.test(err.message) && err.hint === 'Publish it first: rwk deploy "D:\\G"');
  await assert.rejects(publishedSiteOf({}, game, { folder: "g", command: "upgrade" }), /nothing to upgrade/);
});

test("list: each site of a game names the others", async (t) => {
  quietly(t);
  const listed = await list({ connect: async () => ({}), loadSettings: () => ({}), loadGameConfigs: async () => two });
  assert.deepEqual(
    listed.sites.map((s) => [s.site, s.sameGame]),
    [
      ["game1v1", ["game1v2"]],
      ["game1v2", ["game1v1"]],
      ["other", []],
    ]
  );
});

test("rename --dry-run of one of several sites: that site, and the command to run names it", async (t) => {
  quietly(t);
  const { preview } = await import("../cli/commands/preview.js");
  const configs = { "mz:1": { ...v1, auth: { mode: "access" } }, "mz:1@game1v2": { ...v2, auth: { mode: "access" } } };
  const result = await preview(game, null, configs, { inputPath: "g", rename: true, to: "game1v3", name: "game1v2" });
  assert.equal(result.site, "game1v2");
  assert.match(result.next[0], /rwk rename "g" --name game1v2 --to game1v3/);
  await assert.rejects(preview(game, null, configs, { inputPath: "g", rename: true, to: "game1v1", name: "game1v2" }), /already used/);
});
