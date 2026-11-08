// The deploy's ZIP (cli/lib/zip.js): a valid archive, the files it holds, and
// the ZIP64 records a large build needs.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32, endRecords, records, writeZip } from "../cli/lib/zip.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rwk-zip-"));
}

// The entries in a ZIP, read back from its central directory.
function readEntries(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    assert.equal(buf.readUInt32LE(locator), 0x07064b50, "ZIP64 locator present");
    const eocd64 = Number(buf.readBigUInt64LE(locator + 8));
    assert.equal(buf.readUInt32LE(eocd64), 0x06064b50, "ZIP64 end record present");
    count = Number(buf.readBigUInt64LE(eocd64 + 32));
    cdSize = Number(buf.readBigUInt64LE(eocd64 + 40));
    cdOffset = Number(buf.readBigUInt64LE(eocd64 + 48));
  }
  const out = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, "central directory record");
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    // Read the data back through the local header.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    let size = buf.readUInt32LE(localOffset + 22);
    if (size === 0xffffffff) size = Number(buf.readBigUInt64LE(localOffset + 30 + localNameLen + 4));
    const dataAt = localOffset + 30 + localNameLen + localExtraLen;
    out.push({ name, data: buf.subarray(dataAt, dataAt + size), stored: buf.readUInt16LE(localOffset + 8) === 0 });
    at += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(at, cdOffset + cdSize, "the central directory ends where it says");
  return out;
}

test("zip: writes a valid STORED archive with every file, byte for byte", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "img"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>hi</html>");
  fs.writeFileSync(path.join(dir, "img", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  const out = path.join(dir, "build.zip");
  const made = await writeZip(out, [
    { rel: "index.html", abs: path.join(dir, "index.html") },
    { rel: "img/a.png", abs: path.join(dir, "img", "a.png") },
  ]);
  assert.equal(made.entries, 2);
  assert.equal(made.bytes, fs.statSync(out).size, "the reported size is the file's size");

  const entries = readEntries(out);
  assert.deepEqual(entries.map((e) => e.name), ["index.html", "img/a.png"]);
  assert.equal(entries[0].data.toString("utf8"), "<html>hi</html>");
  assert.deepEqual([...entries[1].data], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  assert.ok(entries.every((e) => e.stored), "entries are STORED (no compression)");
});

test("zip: an empty archive is a valid, empty ZIP", async () => {
  const dir = tmp();
  const out = path.join(dir, "empty.zip");
  const made = await writeZip(out, []);
  assert.equal(made.entries, 0);
  const buf = fs.readFileSync(out);
  assert.equal(buf.length, 22, "just the end of central directory record");
  assert.equal(buf.readUInt32LE(0), 0x06054b50);
  assert.deepEqual(readEntries(out), []);
});

test("zip: names are UTF-8 and keep their folders", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "f.txt"), "x");
  const out = path.join(dir, "u.zip");
  await writeZip(out, [{ rel: "audio/bgm/日本語+1.ogg", abs: path.join(dir, "f.txt") }]);
  assert.deepEqual(readEntries(out).map((e) => e.name), ["audio/bgm/日本語+1.ogg"]);
});

test("zip: writes ZIP64 records for a build over 4 GiB, or with over 65535 files", () => {
  // The records only: writing a real 4 GiB archive in a test would take minutes.
  const big = records(Buffer.from("big.bin"), { time: 0, date: 0, crc: 0, size: 0x100000000, offset: 0, zip64: true });
  assert.equal(big.local.readUInt16LE(4), 45, "version needed 4.5");
  assert.equal(big.local.readUInt32LE(18), 0xffffffff, "size in the extra field, not the header");
  assert.equal(big.local.readUInt16LE(28), 20, "extra field: id, length, size, compressed size");
  assert.equal(Number(big.local.readBigUInt64LE(30 + 7 + 4)), 0x100000000, "the 4 GiB size");

  const end = endRecords({ count: 70000, cdSize: 10, cdOffset: 0x100000000, zip64: true });
  assert.equal(end.readUInt32LE(0), 0x06064b50, "ZIP64 end record");
  assert.equal(Number(end.readBigUInt64LE(32)), 70000, "entry count beyond 65535");
  const locator = 56;
  assert.equal(end.readUInt32LE(locator), 0x07064b50, "ZIP64 locator");
  assert.equal(Number(end.readBigUInt64LE(locator + 8)), 0x100000000 + 10, "it points at the ZIP64 end record, after the directory");
  const eocd = locator + 20; // the locator is 20 bytes
  assert.equal(end.readUInt32LE(eocd), 0x06054b50, "the old end record still closes the archive");
  assert.equal(end.readUInt16LE(eocd + 10), 0xffff, "with 0xffff as a marker");

  const small = endRecords({ count: 3, cdSize: 100, cdOffset: 200, zip64: false });
  assert.equal(small.length, 22, "a small build needs no ZIP64 records");
  assert.equal(small.readUInt16LE(10), 3);
});

test("zip: a central directory record with a size over 4 GiB carries it in the extra field", () => {
  const r = records(Buffer.from("x.bin"), { time: 0, date: 0, crc: 1, size: 0x100000001, offset: 0xffffffff, zip64: true });
  assert.equal(r.central.readUInt32LE(20), 0xffffffff, "size replaced by the marker");
  assert.equal(r.central.readUInt32LE(42), 0xffffffff, "offset replaced by the marker");
  assert.equal(r.central.readUInt16LE(30), 28, "extra: id, length, size, compressed, offset");
  assert.equal(Number(r.central.readBigUInt64LE(46 + 5 + 4)), 0x100000001, "the true size");
  assert.equal(Number(r.central.readBigUInt64LE(46 + 5 + 20)), 0xffffffff, "the true offset");
});

test("zip: crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("zip: a missing file fails with that file, not a truncated archive", async () => {
  const dir = tmp();
  const out = path.join(dir, "x.zip");
  await assert.rejects(() => writeZip(out, [{ rel: "gone.bin", abs: path.join(dir, "gone.bin") }]), /ENOENT/);
});
