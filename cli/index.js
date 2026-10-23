#!/usr/bin/env node
import { deploy } from "./commands/deploy.js";
import { c, log } from "./lib/ui.js";

const HELP = `
${c.bold("rpgmaker-web-toolkit")}: đưa game RPG Maker MZ/MV lên Cloudflare Workers

  rwk "<thư mục game>"                Deploy lần đầu hoặc cập nhật (chỉ tải lên file thay đổi)
  rwk import-saves "<thư mục game>"   Tải save trên máy (thư mục save/) lên cloud
  rwk help                            Trợ giúp
`;

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`Cần Node.js 20 trở lên (đang dùng ${process.versions.node}).`);

  const [first, ...rest] = process.argv.slice(2);
  switch (first) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "deploy":
      return deploy(rest.join(" ") || undefined);
    case "import-saves":
      return deploy(rest.join(" ") || undefined, { importOnly: true });
    default:
      return deploy(process.argv.slice(2).join(" ") || undefined);
  }
}

process.on("SIGINT", () => {
  console.log("\nĐã huỷ.");
  process.exit(130);
});

main().catch((err) => {
  log.error(err.message);
  if (process.env.RWK_DEBUG) console.error(err);
  process.exit(1);
});
