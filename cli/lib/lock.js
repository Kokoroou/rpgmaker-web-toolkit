// A lock between the processes of this PC (several `rwk deploy` running at once,
// from one command or from several terminals): a file created with the "wx" flag,
// which only one process can do. It holds the owner's pid, so a lock left by a
// process that died is taken over instead of waited for.

import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // alive, but not ours
  }
}

function ownerOf(file) {
  try {
    return Number.parseInt(fs.readFileSync(file, "utf8"), 10);
  } catch {
    return null;
  }
}

// Runs fn() while holding the lock `file`; waits up to timeoutMs for another holder.
// A lock whose owner is gone, or older than staleMs, is taken over.
export async function withLock(file, fn, { timeoutMs = 60_000, staleMs = 120_000, pollMs = 50 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    const owner = ownerOf(file);
    let age = 0;
    try {
      age = Date.now() - fs.statSync(file).mtimeMs;
    } catch {
      continue; // released just now
    }
    // An unreadable owner is a lock being written: only age can tell it is stale.
    if ((owner && !pidAlive(owner)) || age > staleMs) {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Another rwk run holds ${file} (pid ${owner || "?"}). If none is running, delete that file.`);
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    // Only our own lock: a long fn may have had it taken over as stale.
    if (ownerOf(file) === process.pid) fs.rmSync(file, { force: true });
  }
}
