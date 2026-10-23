// Identifies the player behind a request.
// AUTH_MODE "access": verify the Cloudflare Access JWT (never trust headers alone,
// so a request that somehow bypasses Access still gets rejected).
// AUTH_MODE "none":   everyone shares the "public" identity.

const encoder = new TextEncoder();
const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map(); // teamDomain -> { at, keys: Map<kid, CryptoKey> }

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function identify(request, env) {
  const mode = env.AUTH_MODE || "locked";
  if (mode === "none") return { email: "public" };
  if (mode !== "access") throw new AuthError("Authentication is not configured", 503);

  const token = request.headers.get("cf-access-jwt-assertion") || readCookie(request, "CF_Authorization");
  if (!token) throw new AuthError("Missing Cloudflare Access token");
  const payload = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!payload.email) throw new AuthError("Access token has no email (service tokens are not supported)", 403);
  return { email: payload.email };
}

export async function userHash(email) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function verifyAccessJwt(token, teamDomain, aud) {
  if (!teamDomain || !aud) throw new AuthError("ACCESS_TEAM_DOMAIN / ACCESS_AUD are not set", 503);
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed token");
  const [rawHeader, rawPayload, rawSignature] = parts;
  let header, payload;
  try {
    header = JSON.parse(decodeText(base64UrlDecode(rawHeader)));
    payload = JSON.parse(decodeText(base64UrlDecode(rawPayload)));
  } catch {
    throw new AuthError("Malformed token");
  }
  if (header.alg !== "RS256") throw new AuthError("Unsupported token algorithm");

  const key = await accessKey(teamDomain, header.kid);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(rawSignature),
    encoder.encode(`${rawHeader}.${rawPayload}`)
  );
  if (!valid) throw new AuthError("Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new AuthError("Token audience mismatch", 403);
  if (typeof payload.exp === "number" && payload.exp < now) throw new AuthError("Token expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) throw new AuthError("Token not yet valid");
  if (payload.iss && payload.iss !== `https://${teamDomain}`) throw new AuthError("Token issuer mismatch", 403);
  return payload;
}

async function accessKey(teamDomain, kid) {
  let entry = jwksCache.get(teamDomain);
  if (!entry || Date.now() - entry.at > JWKS_TTL_MS || !entry.keys.has(kid)) {
    entry = { at: Date.now(), keys: await fetchKeys(teamDomain) };
    jwksCache.set(teamDomain, entry);
  }
  const key = entry.keys.get(kid);
  if (!key) throw new AuthError("Unknown token key");
  return key;
}

async function fetchKeys(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError(`Cannot load Access certificates (${res.status})`, 502);
  const { keys = [] } = await res.json();
  const result = new Map();
  for (const jwk of keys) {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    result.set(jwk.kid, key);
  }
  return result;
}

function readCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function base64UrlDecode(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}
