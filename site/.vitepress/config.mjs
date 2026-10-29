import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";
import { SITE_URL, buildLlmsTxt, pageHead, pagePath, redirectHead } from "./seo.mjs";

const repo = "https://github.com/Kokoroou/rpgmaker-web-toolkit";

// Pages that only point to where their content moved (`redirect:` in the front matter):
// left out of the sitemap, so search engines index the new page instead.
const redirects = new Set();

export default defineConfig({
  title: "rpgmaker-web-toolkit",
  description: "Publish an RPG Maker MZ / MV game to Cloudflare Workers, with cloud saves and an on-screen gamepad.",
  base: "/rpgmaker-web-toolkit/",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: SITE_URL,
    transformItems: (items) => items.filter((item) => !redirects.has(item.url)),
  },
  transformPageData(pageData) {
    pageData.frontmatter.head ??= [];
    const { redirect } = pageData.frontmatter;
    if (redirect) redirects.add(pagePath(pageData.relativePath));
    pageData.frontmatter.head.push(...(redirect ? redirectHead(pageData, redirect) : pageHead(pageData)));
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
          { text: "Translations", link: "/setup/languages" },
          { text: "On-screen buttons", link: "/setup/controls" },
          { text: "Troubleshooting", link: "/setup/troubleshooting" },
        ],
      },
      // Play, then one section per group of the in-game ⚙ menu, in the menu's order.
      {
        text: "Play",
        items: [
          { text: "Open and play", link: "/play/" },
          { text: "Menu map", link: "/play/menu" },
          { text: "Toolbar", link: "/play/toolbar" },
        ],
      },
      {
        text: "Speed and movement",
        items: [{ text: "Fast forward and always dash", link: "/play/speed" }],
      },
      {
        text: "Messages",
        items: [{ text: "Auto, Skip and the log", link: "/play/messages" }],
      },
      {
        text: "Items",
        items: [{ text: "Use several items at once", link: "/play/items" }],
      },
      {
        text: "Saves",
        items: [
          { text: "Cloud saves", link: "/play/saves" },
          { text: "Quick save and autosave", link: "/play/quick-save" },
          { text: "Older saves", link: "/play/older-saves" },
          { text: "Save files", link: "/play/save-files" },
        ],
      },
      {
        text: "Cheats",
        items: [{ text: "Cheats", link: "/play/cheats" }],
      },
      {
        text: "Controls",
        items: [
          { text: "Touch controls", link: "/play/controls" },
          { text: "Keys and buttons", link: "/play/keys" },
        ],
      },
      {
        text: "Display",
        items: [
          { text: "Language", link: "/play/language" },
          { text: "Live translation", link: "/play/translate" },
        ],
      },
      {
        text: "Offline",
        items: [{ text: "Play offline", link: "/play/offline" }],
      },
      {
        text: "Help",
        items: [{ text: "Report a problem, game files", link: "/play/help" }],
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
