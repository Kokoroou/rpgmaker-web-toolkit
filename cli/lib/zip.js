// Builds the ZIP that the game's host downloads from the site (⚙ → Share →
// Download game, worker/download.js). The CLI makes it at deploy and uploads it
// to R2 as one object: a Worker cannot stream a game's thousands of files
// itself, because each file it reads is a subrequest and the free plan allows
// far fewer of those than a game has files.
//
// Entries are STORED (not deflated): game pictures, audio and video do not
// shrink, and the archive is ready in seconds. ZIP64 is written when a build
// needs it (over 4 GiB, or more than 65535 files), since games can be that big.
//
// ZIP spec references: APPNOTE.TXT §4.3 (records), §4.5 (ZIP64).

import fs from "node:fs";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

// CRC-32 (ISO 3309 / ZIP), the same table worker/download.js used.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

// DOS date and time of a file, so an extracted build keeps its dates.
function dosStamp(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

// A STORED entry's local header and its central directory record.
// size, crc, offset: numbers; zip64: whether the entry needs the extra field.
export function records(name, { time, date, crc, size, offset, zip64 }) {
  const extraLocal = zip64 ? Buffer.concat([u16(ZIP64_EXTRA_ID), u16(16), u64(size), u64(size)]) : Buffer.alloc(0);
  const local = Buffer.concat([
    u32(LOCAL_SIG),
    u16(zip64 ? 45 : 20), // version needed: 4.5 for ZIP64
    u16(0x0800), // general purpose bit flag: names are UTF-8
    u16(0), // compression method: STORED
    u16(time),
    u16(date),
    u32(crc),
    u32(zip64 ? MAX32 : size), // compressed size
    u32(zip64 ? MAX32 : size), // uncompressed size
    u16(name.length),
    u16(extraLocal.length),
    name,
    extraLocal,
  ]);

  // The central directory keeps the true sizes only in the extra field.
  const extraCentral = zip64
    ? Buffer.concat([u16(ZIP64_EXTRA_ID), u16(24), u64(size), u64(size), u64(offset)])
    : Buffer.alloc(0);
  const central = Buffer.concat([
    u32(CENTRAL_SIG),
    u16(zip64 ? 45 : 20), // version made by
    u16(zip64 ? 45 : 20), // version needed
    u16(0x0800),
    u16(0),
    u16(time),
    u16(date),
    u32(crc),
    u32(zip64 ? MAX32 : size),
    u32(zip64 ? MAX32 : size),
    u16(name.length),
    u16(extraCentral.length),
    u16(0), // comment length
    u16(0), // disk number start
    u16(0), // internal attributes
    u32(0), // external attributes
    u32(zip64 ? MAX32 : offset),
    name,
    extraCentral,
  ]);
  return { local, central };
}

export function endRecords({ count, cdSize, cdOffset, zip64 }) {
  const records = [];
  if (zip64) {
    const cdEnd = cdOffset + cdSize;
    const eocd64Offset = cdEnd;
    records.push(
      Buffer.concat([
        u32(EOCD64_SIG),
        u64(44), // size of the rest of this record
        u16(45), // version made by
        u16(45), // version needed
        u32(0), // this disk
        u32(0), // disk with the central directory
        u64(count), // entries on this disk
        u64(count), // entries in all
        u64(cdSize),
        u64(cdOffset),
      ])
    );
    records.push(Buffer.concat([u32(EOCD64_LOCATOR_SIG), u32(0), u64(eocd64Offset), u32(1)]));
  }
  records.push(
    Buffer.concat([
      u32(EOCD_SIG),
      u16(0), // this disk
      u16(0), // disk with the central directory
      u16(zip64 ? MAX16 : count),
      u16(zip64 ? MAX16 : count),
      u32(zip64 ? MAX32 : cdSize),
      u32(zip64 ? MAX32 : cdOffset),
      u16(0), // comment length
    ])
  );
  return Buffer.concat(records);
}

// entries: [{ rel, abs }] (rel is POSIX, the path inside the archive).
// Files are read twice (once for the CRC, once to copy them), so a movie larger
// than the machine's memory is fine. -> { entries, bytes }
export async function writeZip(outPath, entries) {
  const out = fs.createWriteStream(outPath);
  // One error listener for the whole archive (a per-write one would leak
  // thousands of listeners on a real game).
  let failure = null;
  out.on("error", (err) => (failure = err));
  const write = (buf) =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      if (out.write(buf)) return resolve();
      const done = (err) => (err ? reject(err) : resolve());
      out.once("drain", () => done());
      out.once("error", done);
    });
  const copyInto = (abs) =>
    new Promise((resolve, reject) => {
      const input = fs.createReadStream(abs);
      input.on("error", reject);
      input.on("end", resolve);
      input.pipe(out, { end: false });
    });

  try {
    const central = [];
    let offset = 0;
    let done = 0;
    for (const entry of entries) {
      const st = fs.statSync(entry.abs);
      const name = Buffer.from(entry.rel, "utf8");
      const crc = await crcOfFile(entry.abs);
      const zip64 = st.size >= MAX32 || offset >= MAX32;
      const { local, central: record } = records(name, { ...dosStamp(st.mtimeMs), crc, size: st.size, offset, zip64 });
      await write(local);
      await copyInto(entry.abs);
      if (failure) throw failure;
      central.push(record);
      offset += local.length + st.size;
      done++;
    }

    const cdOffset = offset;
    const cd = Buffer.concat(central);
    await write(cd);
    const end = endRecords({ count: entries.length, cdSize: cd.length, cdOffset, zip64: entries.length > MAX16 || cdOffset >= MAX32 || cd.length >= MAX32 });
    await write(end);
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    return { entries: done, bytes: cdOffset + cd.length + end.length };
  } catch (err) {
    out.destroy();
    throw err;
  }
}

function crcOfFile(abs) {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff;
    const input = fs.createReadStream(abs);
    input.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    });
    input.on("error", reject);
    input.on("end", () => resolve((crc ^ 0xffffffff) >>> 0));
  });
}
