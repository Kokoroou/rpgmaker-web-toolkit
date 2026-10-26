import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";
import { SITE_URL, buildLlmsTxt, pageHead } from "./seo.mjs";

const repo = "https://github.com/Kokoroou/rpgmaker-web-toolkit";

export default defineConfig({
  title: "rpgmaker-web-toolkit",
  description: "Publish an RPG Maker MZ / MV game to Cloudflare Workers, with cloud saves and an on-screen gamepad.",
  base: "/rpgmaker-web-toolkit/",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },
  transformPageData(pageData) {
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(...pageHead(pageData));
  },
  buildEnd(siteConfig) {
    const { sidebar } = siteConfig.userConfig.themeConfig;
    const text = buildLlmsTxt({ srcDir: siteConfig.srcDir, sidebar, description: siteConfig.userConfig.description });
    fs.writeFileSync(path.join(siteConfig.outDir, "llms.txt"), text);
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/rpgmaker-web-toolkit/logo.svg" }],
    ["meta", { name: "theme-color", content: "#2a347a" }],
    // Google Search Console ownership check.
    ["meta", { name: "google-site-verification", content: "D46-YM3xEG9mxpWY-GFgkCDtK37Q7nqxAwHNLEpttl8" }],
  ],

  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },

    nav: [
      { text: "Set up", link: "/setup/requirements", activeMatch: "/setup/" },
      { text: "Play", link: "/play/", activeMatch: "/play/" },
      { text: "Reference", link: "/reference/commands", activeMatch: "/reference/" },
      { text: "Game creators", link: "/creators/", activeMatch: "/creators/" },
    ],

    sidebar: [
      {
        text: "Set up a game",
        items: [
          { text: "Before you start", link: "/setup/requirements" },
          { text: "Set up Cloudflare", link: "/setup/cloudflare" },
          { text: "First deploy", link: "/setup/first-deploy" },
          { text: "Protect the site and invite players", link: "/setup/access" },
          { text: "Update the game", link: "/setup/updating" },
          { text: "Publish from CI", link: "/setup/ci" },
          { text: "Customize the game", link: "/setup/configuration" },
          { text: "On-screen buttons", link: "/setup/controls" },
          { text: "Troubleshooting", link: "/setup/troubleshooting" },
        ],
      },
      {
        text: "Play",
        items: [
          { text: "Open and play", link: "/play/" },
          { text: "Touch controls", link: "/play/controls" },
          { text: "Saves on several devices", link: "/play/saves" },
          { text: "Quick save and autosave", link: "/play/quick-save" },
          { text: "Edit or move a save", link: "/play/save-files" },
          { text: "Fast forward", link: "/play/speed" },
          { text: "Messages: Auto and Skip", link: "/play/messages" },
          { text: "Always dash", link: "/play/dash" },
          { text: "Keys and buttons", link: "/play/keys" },
          { text: "Use several items at once", link: "/play/items" },
          { text: "Cheats", link: "/play/cheats" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/reference/commands" },
          { text: "Config keys", link: "/reference/config" },
          { text: "How it works", link: "/reference/how-it-works" },
          { text: "Free plan limits", link: "/reference/limits" },
          { text: "Credits and licenses", link: "/reference/credits" },
        ],
      },
      {
        text: "Game creators",
        items: [
          { text: "For game creators", link: "/creators/" },
          { text: "Hosting policy", link: "/creators/policy" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/main/site/:path`, text: "Edit this page on GitHub" },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: {
      message:
        "PolyForm Noncommercial License 1.0.0, plus any use by game creators for their own games. For games you own, played by you.<br>" +
        'Screenshots: <a href="https://yancharkin.itch.io/gamedev-the-beginning">GameDev: The Beginning</a> by yancharkin, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> (<a href="/rpgmaker-web-toolkit/reference/credits">credits</a>). Not affiliated with Cloudflare or RPG Maker.',
    },
  },
});
