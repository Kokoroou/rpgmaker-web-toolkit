// Search engine and AI discoverability helpers for the guide (see docs/ROADMAP.md, "SEO / AIEO").
// Used by config.mjs: per-page head tags (canonical, Open Graph, Twitter, JSON-LD), length limits,
// and llms.txt generated at build time from the sidebar and each page's front matter.
import fs from "node:fs";
import path from "node:path";

export const SITE_URL = "https://kokoroou.github.io/rpgmaker-web-toolkit/";
export const SITE_NAME = "rpgmaker-web-toolkit";
export const REPO_URL = "https://github.com/Kokoroou/rpgmaker-web-toolkit";
export const OG_IMAGE = `${SITE_URL}img/og-image.png`;
export const OG_ALT = "rpgmaker-web-toolkit: play your RPG Maker game in any browser";

// Limits checked at build time. The title limit covers the whole <title> (page + site name).
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 160;

/** Canonical URL of a page (cleanUrls: no .md, `index` becomes the folder). */
export function pageUrl(relativePath) {
  const p = relativePath.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");
  return SITE_URL + p;
}

/** The page's own title, as it appears in <title>. The home page shows only the site name. */
export function fullTitle(pageData) {
  if (pageData.relativePath === "index.md") return SITE_NAME;
  return `${pageData.title} | ${SITE_NAME}`;
}

const meta = (attrs) => ["meta", attrs];

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description:
    "Publishes an RPG Maker MZ or MV game to Cloudflare Workers on the free plan, with cloud saves, an on-screen gamepad for phones and email login. For games you own, played by you.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Windows (to publish); any modern browser (to play)",
  softwareRequirements: "Node.js 22 or newer, a free Cloudflare account",
  license: "https://polyformproject.org/licenses/noncommercial/1.0.0/",
  codeRepository: REPO_URL,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const howToFirstDeploy = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "Publish an RPG Maker game to Cloudflare Workers",
  description:
    "Publish an RPG Maker MZ or MV game you own to your own Cloudflare account with one PowerShell command.",
  tool: [
    { "@type": "HowToTool", name: "Windows PowerShell" },
    { "@type": "HowToTool", name: "Node.js 22 or newer" },
    { "@type": "HowToTool", name: "A free Cloudflare account" },
  ],
  step: [
    {
      "@type": "HowToStep",
      name: "Run the command",
      text: "Open PowerShell, paste the one-line command and drag the game folder into the window when asked.",
    },
    {
      "@type": "HowToStep",
      name: "Log in to Cloudflare",
      text: "The first time on a PC, a browser opens to log in to Cloudflare. Select Allow.",
    },
    {
      "@type": "HowToStep",
      name: "Answer the questions",
      text: "Choose a site name and whether to enable cloud save sync and the on-screen gamepad. Enter takes the suggestion.",
    },
    {
      "@type": "HowToStep",
      name: "Protect the site",
      text: "Choose Cloudflare Access so that only the emails you allow can open the game.",
    },
    {
      "@type": "HowToStep",
      name: "Open the link",
      text: "The last line of the output is the link to the game, on your own workers.dev address.",
    },
  ],
};

// Pages that are really a list of questions and answers would be listed here, with their
// Question / Answer pairs, and emitted as FAQPage. None of the current pages is one
// (Troubleshooting is an error-to-fix table), so no FAQPage is emitted.
const jsonLdByPage = {
  "index.md": [softwareApplication],
  "setup/first-deploy.md": [howToFirstDeploy],
};

/** Throws when a page breaks the length limits, so a bad title or description never ships. */
export function checkLimits(pageData) {
  const where = pageData.relativePath;
  const title = fullTitle(pageData);
  const desc = pageData.frontmatter.description;
  if (title.length > MAX_TITLE) throw new Error(`${where}: title "${title}" is ${title.length} characters (max ${MAX_TITLE})`);
  if (!desc) throw new Error(`${where}: add a description to the front matter`);
  if (desc.length > MAX_DESCRIPTION) throw new Error(`${where}: description is ${desc.length} characters (max ${MAX_DESCRIPTION})`);
}

/** Extra <head> entries for one page: canonical, Open Graph, Twitter card, JSON-LD. */
export function pageHead(pageData) {
  checkLimits(pageData);
  const title = fullTitle(pageData);
  const description = pageData.frontmatter.description;
  const url = pageUrl(pageData.relativePath);
  const head = [
    ["link", { rel: "canonical", href: url }],
    meta({ property: "og:type", content: pageData.relativePath === "index.md" ? "website" : "article" }),
    meta({ property: "og:site_name", content: SITE_NAME }),
    meta({ property: "og:locale", content: "en_US" }),
    meta({ property: "og:title", content: title }),
    meta({ property: "og:description", content: description }),
    meta({ property: "og:url", content: url }),
    meta({ property: "og:image", content: OG_IMAGE }),
    meta({ property: "og:image:width", content: "1200" }),
    meta({ property: "og:image:height", content: "630" }),
    meta({ property: "og:image:alt", content: OG_ALT }),
    meta({ name: "twitter:card", content: "summary_large_image" }),
    meta({ name: "twitter:title", content: title }),
    meta({ name: "twitter:description", content: description }),
    meta({ name: "twitter:image", content: OG_IMAGE }),
    meta({ name: "twitter:image:alt", content: OG_ALT }),
  ];
  for (const data of jsonLdByPage[pageData.relativePath] ?? []) {
    head.push(["script", { type: "application/ld+json" }, JSON.stringify(data)]);
  }
  return head;
}

function readDescription(srcDir, relativePath) {
  const text = fs.readFileSync(path.join(srcDir, relativePath), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = fm && /^description:\s*(.+)$/m.exec(fm[1]);
  if (!line) throw new Error(`${relativePath}: no description in the front matter`);
  return JSON.parse(line[1]);
}

function linkToFile(link) {
  const clean = link.replace(/[#?].*$/, "");
  return clean.endsWith("/") ? `${clean.slice(1)}index.md` : `${clean.slice(1)}.md`;
}

/** The llms.txt file (https://llmstxt.org): a summary, the rules that matter, and the pages. */
export function buildLlmsTxt({ srcDir, sidebar, description }) {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${description}`,
    "",
    "The toolkit is a free command-line tool. A person who owns an RPG Maker MZ or MV game runs one PowerShell command on their Windows PC; it builds a web copy of the game and puts it on their own Cloudflare account (free plan, no server to run). Players open a link in any browser, sign in with an email, and get cloud saves that follow them across devices and an on-screen gamepad on phones.",
    "",
    "## Important",
    "",
    `- For games you own, played by you. A public or widely shared site is redistribution, which only the game's creators can allow. Cloudflare Access (email login) is on by default and should stay on. [Responsible use](${pageUrl("index.md")}).`,
    `- Game creators control hosting of their own game with an \`rwk-policy.json\` file, and the toolkit follows it: [Hosting policy](${pageUrl("creators/policy.md")}).`,
    `- It does not host games for anyone: every game lives on the Cloudflare account of the person who publishes it. [For game creators](${pageUrl("creators/index.md")}).`,
    `- Requirements: a Windows PC to publish (players use any browser), Node.js 22+, a free Cloudflare account with a payment method on file for R2 and Access. [Before you start](${pageUrl("setup/requirements.md")}).`,
    `- Limits of the Cloudflare free plan apply: [Free plan limits](${pageUrl("reference/limits.md")}).`,
    "- Not supported: RPG Maker XP, VX and VX Ace. Not affiliated with Cloudflare or RPG Maker.",
    "",
  ];
  for (const group of sidebar) {
    lines.push(`## ${group.text}`, "");
    for (const item of group.items) {
      const file = linkToFile(item.link);
      lines.push(`- [${item.text}](${pageUrl(file)}): ${readDescription(srcDir, file)}`);
    }
    lines.push("");
  }
  lines.push("## Optional", "", `- [Source code and releases](${REPO_URL}): the CLI, the Worker and the browser plugins.`, "");
  return lines.join("\n");
}
