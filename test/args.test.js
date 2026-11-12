// The command line: commands, targets and flags.

import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS, commandHelp, generalHelp, parseCommandLine } from "../cli/lib/args.js";
import { classifyTarget, expectTarget, siteNameOf } from "../cli/lib/target.js";
import { supportsUnicode, useColor } from "../cli/lib/ui.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });

test("commands: one or two words, then the target", () => {
  const deploy = parse(["deploy", "D:\\Games\\My", "Game"]);
  assert.equal(deploy.spec.name, "deploy");
  assert.equal(deploy.target, "D:\\Games\\My Game", "an unquoted path with spaces is joined back");
  assert.equal(parse(["saves", "import", "g"]).spec.name, "saves import");
  assert.equal(parse(["config", "my-game"]).target, "my-game");
  const rename = parse(["rename", "g", "--to", "new-name"]);
  assert.deepEqual([rename.spec.name, rename.target, rename.flags.to], ["rename", "g", "new-name"]);
  assert.equal(parse(["deploy"]).target, undefined);
  assert.equal(parse([]).spec, null, "no command: the one-liner asks for the game");
});

test("flags: before or after the command", () => {
  for (const args of [["--yes", "--quiet", "deploy", "g"], ["deploy", "g", "--yes", "-q"], ["deploy", "--yes", "g", "--quiet"]]) {
    const cli = parse(args);
    assert.deepEqual([cli.spec.name, cli.target, cli.flags.yes, cli.flags.quiet, cli.unattended], ["deploy", "g", true, true, true]);
  }
  assert.equal(parse(["--version"]).flags.version, true);
  assert.equal(parse(["deploy", "--help"]).flags.help, true);
  assert.equal(parse(["--no-color", "deploy", "g"]).flags.noColor, true);
});

test("help: rwk help, --help and per-command help", () => {
  const help = parse(["help", "deploy"]);
  assert.deepEqual([help.spec.name, help.flags.help], ["deploy", true]);
  assert.deepEqual([parse(["help"]).spec, parse(["help"]).flags.help], [null, true]);
  for (const spec of COMMANDS) {
    assert.match(generalHelp(), new RegExp(`^  ${spec.name} `, "m"));
    assert.match(commandHelp(spec), new RegExp(`Usage:\\n  rwk ${spec.name} `));
  }
});

test("usage errors: exit code 64, with what to do instead", () => {
  const fails = (args, message, hint) =>
    assert.throws(() => parse(args), (err) => err.exitCode === 64 && message.test(err.message) && hint.test(err.hint), args.join(" "));
  fails(["D:\\Games\\My Game"], /Unknown command/, /rwk deploy "D:\\Games\\My Game"/);
  fails(["https://my-game.alice.workers.dev"], /Unknown command/, /rwk upgrade/);
  fails(["dploy", "g"], /Unknown command "dploy"/, /Did you mean "rwk deploy"/);
  fails(["saves"], /needs a subcommand/, /rwk saves import/);
  fails(["deploy", "g", "--bogus"], /Unknown option --bogus/, /rwk --help/);
  fails(["deploy", "g", "--to", "x"], /Unknown option --to/, /Usage: rwk deploy/);
  fails(["rename", "g", "--to"], /./, /--to/);
});

test("targets: a folder, a link or a site name", () => {
  const nothing = { isDir: () => false };
  assert.deepEqual(classifyTarget("https://my-game.alice.workers.dev/", nothing), { kind: "link", value: "https://my-game.alice.workers.dev/" });
  assert.equal(classifyTarget("my-game.alice.workers.dev", nothing).kind, "link");
  assert.equal(classifyTarget("my-game", nothing).kind, "name");
  assert.equal(classifyTarget("my-game", { isDir: () => true }).kind, "folder", "a folder of that name wins");
  for (const folder of ["D:\\Games\\My Game", "C:", "~/Games", "./game", "../game", "games/g", "My Game"]) {
    assert.equal(classifyTarget(folder, nothing).kind, "folder", folder);
  }
  assert.equal(classifyTarget('"/home/g/My Game"', nothing).value, "/home/g/My Game", "quotes go");

  assert.equal(siteNameOf(classifyTarget("https://my-game.alice.workers.dev", nothing)), "my-game");
  assert.equal(siteNameOf(classifyTarget("my-game", nothing)), "my-game");
  assert.throws(() => expectTarget("./game", ["link", "name"], "rwk upgrade <game link | site name>"), (err) => err.exitCode === 64 && /game link or a site name/.test(err.message));
  assert.equal(expectTarget("./game", ["folder"], "x").kind, "folder");
  const upgrade = COMMANDS.find((cmd) => cmd.name === "upgrade");
  assert.deepEqual(upgrade.targets, ["folder", "link", "name"], "upgrade takes the folder too, for its site name");
});

test("terminal: colors and symbols follow NO_COLOR, TERM and the locale", () => {
  assert.equal(useColor({}, true), true);
  assert.equal(useColor({}, false), false, "not a terminal");
  assert.equal(useColor({ NO_COLOR: "1" }, true), false);
  assert.equal(useColor({ TERM: "dumb" }, true), false);
  assert.equal(useColor({ FORCE_COLOR: "1" }, false), true);
  assert.equal(supportsUnicode({}), true);
  assert.equal(supportsUnicode({ LANG: "en_US.UTF-8" }), true);
  assert.equal(supportsUnicode({ LANG: "C" }), false);
  assert.equal(supportsUnicode({ RWK_ASCII: "1" }), false);
  assert.equal(supportsUnicode({ TERM: "dumb" }), false);
});

test("upgrade: several games or --all", () => {
  const several = parse(["upgrade", "one", "two", "https://three.alice.workers.dev"]);
  assert.deepEqual(several.targets, ["one", "two", "https://three.alice.workers.dev"]);
  assert.deepEqual(parse(["upgrade", "one"]).targets, ["one"]);
  assert.deepEqual(parse(["upgrade"]).targets, []);
  assert.deepEqual(parse(["upgrade", "D:\\Games\\My", "Game"]).targets, ["D:\\Games\\My Game"], "a path with spaces stays one game");
  assert.equal(parse(["upgrade", "--all"]).flags.all, true);
  assert.throws(() => parse(["upgrade", "--all", "one"]), (err) => err.exitCode === 64 && /--all takes no game/.test(err.message));
  assert.throws(() => parse(["deploy", "g", "--all"]), (err) => err.exitCode === 64 && /Unknown option --all/.test(err.message));
  assert.match(commandHelp(COMMANDS.find((cmd) => cmd.name === "upgrade")), /rwk upgrade <game folder \| game link \| site name>\.\.\. \[--all\]/);
});

test("help: commands listed by group, each once", () => {
  const help = generalHelp();
  const at = ["Publish:", "Manage a site:", "Cloud saves:", "Account:"].map((g) => help.indexOf(g));
  assert.ok(at.every((n) => n >= 0) && at.every((n, i) => !i || n > at[i - 1]), "groups in order");
  for (const cmd of COMMANDS) {
    assert.ok(cmd.group, `${cmd.name} has a group`);
    assert.equal(help.split("\n").filter((l) => l.startsWith(`  ${cmd.name.padEnd(Math.max(...COMMANDS.map((x) => x.name.length)) + 2)}`)).length, 1, cmd.name);
  }
});
