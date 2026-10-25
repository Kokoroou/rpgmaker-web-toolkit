# Contributing

Branch, PR title and release rules are in [CLAUDE.md](CLAUDE.md): every change goes through a squash-merged PR whose title is a Conventional Commit.

## Develop

```powershell
git clone https://github.com/Kokoroou/rpgmaker-web-toolkit
cd rpgmaker-web-toolkit
npm ci
npm test                         # CLI + Worker tests (node:test, no network)
.\rwk.cmd "D:\Games\My Game"     # run the CLI from the clone (same commands as run.ps1)
```

How the pieces fit: [How it works](site/reference/how-it-works.md).

## User guide (`site/`)

```sh
cd site && npm ci && npm run dev
```

The screenshots in `site/public/img/` come from `site/screenshots/capture.mjs`. It opens a real game published with the toolkit, *GameDev: The Beginning* by yancharkin (CC BY-SA 4.0), in Google Chrome with the plugins swapped for your `runtime/`, and answers the save API itself. It needs a network connection and Chrome. Regenerate them after a UI change:

```sh
cd site
npm install --no-save playwright   # once
npm run screenshots
```

The game screenshots stay under CC BY-SA 4.0 (see `site/reference/credits.md`): keep the credit when you add one.

## CI and releases

Both use the shared workflows of [agent-toolkit](https://github.com/kokoroou/agent-toolkit) (`@v0`).

- **CI** (`.github/workflows/ci.yml`), on every PR and push to `main`: tests on Node.js 24 with a coverage gate (no drop compared to `main`), a Conventional Commit check on the PR title, Semgrep and Gitleaks.
- **Release** (`.github/workflows/release.yml`): release-please keeps a release PR with the version bump and `CHANGELOG.md`. Merging it tags `vX.Y.Z`, publishes the GitHub Release and attaches `rpgmaker-web-toolkit-X.Y.Z.zip`. Run a release with `$env:RWK_REF = "vX.Y.Z"`.
- **Docs** (`.github/workflows/docs.yml`) publishes `site/` to GitHub Pages.

One-time repository setup: Settings → Actions → General → enable *Allow GitHub Actions to create and approve pull requests* (for the release PR). Optional: the `AGENT_APP_ID` / `AGENT_APP_PRIVATE_KEY` secrets of agent-toolkit's GitHub App, so the release PR also triggers CI.
