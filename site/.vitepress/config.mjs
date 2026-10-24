import { defineConfig } from "vitepress";

const repo = "https://github.com/Kokoroou/rpgmaker-web-toolkit";

export default defineConfig({
  title: "rpgmaker-web-toolkit",
  description: "Publish an RPG Maker MZ / MV game to Cloudflare Workers, with cloud saves and an on-screen gamepad.",
  base: "/rpgmaker-web-toolkit/",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/rpgmaker-web-toolkit/logo.svg" }],
    ["meta", { name: "theme-color", content: "#2a347a" }],
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
          { text: "First deploy", link: "/setup/first-deploy" },
          { text: "Protect the site and invite players", link: "/setup/access" },
          { text: "Update the game", link: "/setup/updating" },
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
          { text: "Edit or move a save", link: "/play/save-files" },
          { text: "Fast forward", link: "/play/speed" },
          { text: "Use several items at once", link: "/play/items" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/reference/commands" },
          { text: "Config keys", link: "/reference/config" },
          { text: "How it works", link: "/reference/how-it-works" },
          { text: "Free plan limits", link: "/reference/limits" },
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
      message: "PolyForm Noncommercial License 1.0.0, plus any use by game creators for their own games. For games you own, played by you.",
    },
  },
});
