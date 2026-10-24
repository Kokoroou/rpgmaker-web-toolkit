// In-memory stand-ins for the Workers runtime bindings used by the tests.

import crypto from "node:crypto";

export class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  #meta(key, entry) {
    return {
      key,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      size: entry.body.byteLength,
      uploaded: entry.uploaded,
      customMetadata: entry.customMetadata,
      httpMetadata: entry.httpMetadata || {},
      writeHttpMetadata(headers) {
        if (entry.httpMetadata?.contentType) headers.set("content-type", entry.httpMetadata.contentType);
      },
    };
  }

  async head(key) {
    const entry = this.objects.get(key);
    return entry ? this.#meta(key, entry) : null;
  }

  async get(key, options = {}) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const meta = this.#meta(key, entry);
    const ifNoneMatch = options.onlyIf instanceof Headers ? options.onlyIf.get("if-none-match") : null;
    if (ifNoneMatch && ifNoneMatch.replace(/"/g, "") === entry.etag) return meta;

    let body = entry.body;
    const rangeHeader = options.range instanceof Headers ? options.range.get("range") : null;
    if (rangeHeader) {
      const [, start, end] = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      const s = Number(start);
      const e = end ? Number(end) : body.byteLength - 1;
      body = body.slice(s, e + 1);
      meta.range = { offset: s, length: e - s + 1 };
    }
    return { ...meta, body: new Blob([body]).stream(), async arrayBuffer() { return body; } };
  }

  async put(key, value, options = {}) {
    const existing = this.objects.get(key);
    if (options.onlyIf?.etagMatches && (!existing || existing.etag !== options.onlyIf.etagMatches)) return null;
    const body = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value)).buffer;
    const entry = {
      body,
      etag: crypto.randomBytes(8).toString("hex"),
      uploaded: new Date(),
      customMetadata: options.customMetadata || {},
      httpMetadata: options.httpMetadata,
    };
    this.objects.set(key, entry);
    return this.#meta(key, entry);
  }

  async delete(keys) {
    for (const key of [].concat(keys)) this.objects.delete(key);
  }

  async list({ prefix = "" } = {}) {
    const objects = [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([k, e]) => this.#meta(k, e));
    return { objects, truncated: false };
  }
}

export function makeEnv(overrides = {}) {
  return {
    GAME_ID: "test-game",
    AUTH_MODE: "none",
    RWK_LOCKED: "0",
    BUCKET: new MemoryBucket(),
    ASSETS: { fetch: async () => new Response("static", { status: 200 }) },
    ...overrides,
  };
}
