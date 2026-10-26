// Reading R2 objects through Cloudflare's API, for what wrangler cannot do:
// `wrangler r2 object` has no list. Used to export the cloud saves.

const BASE = "https://api.cloudflare.com/client/v4";

const objectsRoute = (accountId, bucket) => `${BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects`;

function failure(what, status, body) {
  const reason = (body.errors || []).map((e) => e.message).join("; ") || `HTTP ${status}`;
  const hint = status === 403 ? " The API token needs the permission Account → Workers R2 Storage → Read." : "";
  return new Error(`${what}: ${reason}.${hint}`);
}

// -> [{ key, size }] of every object whose key starts with prefix
export async function listObjects({ token, accountId, bucket, prefix, fetchImpl = fetch }) {
  const items = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ prefix, per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const res = await fetchImpl(`${objectsRoute(accountId, bucket)}?${query}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw failure("Could not list the saves in R2", res.status, body);
    for (const item of body.result || []) items.push({ key: item.key, size: item.size });
    const info = body.result_info || {};
    cursor = info.is_truncated && info.cursor ? info.cursor : null;
  } while (cursor);
  return items;
}

// -> Buffer, or null when the object does not exist
export async function getObject({ token, accountId, bucket, key, fetchImpl = fetch }) {
  const res = await fetchImpl(`${objectsRoute(accountId, bucket)}/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw failure(`Could not read ${key} from R2`, res.status, await res.json().catch(() => ({})));
  return Buffer.from(await res.arrayBuffer());
}
