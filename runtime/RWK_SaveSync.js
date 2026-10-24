//=============================================================================
// RWK_SaveSync.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Mirrors browser saves to the cloud (Worker /api/saves) so one account can
// continue the same game on any device.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Cloud save sync. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.sync || !RWK.config.sync.enabled) return;
  if (StorageManager.isLocalMode()) return; // desktop NW.js keeps its own files

  const REQUEST_TIMEOUT_MS = 10000;
  const UPLOAD_TIMEOUT_MS = 30000;
  const PUSH_DELAY_MS = 1200;
  const RETRY_DELAY_MS = 30000;
  const RECENT_OTHER_DEVICE_MS = 5 * 60 * 1000;
  const META_KEY = "rwk.sync." + RWK.config.gameId;

  //---------------------------------------------------------------------------
  // Engine adapters: map engine storage to generic names (config, global, fileN)
  //---------------------------------------------------------------------------

  const adapters = {
    MZ: {
      prefix() {
        return StorageManager.forageKey("");
      },
      async listLocal() {
        const prefix = this.prefix();
        const keys = await localforage.keys();
        return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      },
      read(name) {
        return localforage.getItem(StorageManager.forageKey(name));
      },
      write(name, data) {
        return localforage.setItem(StorageManager.forageKey(name), data);
      },
      remove(name) {
        return localforage.removeItem(StorageManager.forageKey(name));
      },
      install(hooks) {
        const _saveZip = StorageManager.saveZip;
        StorageManager.saveZip = function (saveName, zip) {
          return Promise.resolve(_saveZip.apply(this, arguments)).then((r) => {
            hooks.onSave(saveName);
            return r;
          });
        };
        const _remove = StorageManager.remove;
        StorageManager.remove = function (saveName) {
          const r = _remove.apply(this, arguments);
          Promise.resolve(r).then(() => hooks.onRemove(saveName));
          return r;
        };
        // forageKey() needs $dataSystem, so sync runs once the database is loaded
        // and before Scene_Boot reads global info / config.
        const _isReady = Scene_Boot.prototype.isReady;
        Scene_Boot.prototype.isReady = function () {
          if (!this._databaseLoaded) {
            if (!DataManager.isDatabaseLoaded()) return false;
            if (!this._rwkSync) {
              this._rwkSyncDone = false;
              this._rwkSync = hooks
                .boot()
                .catch((e) => console.error("[RWK] boot sync failed", e))
                .then(() => StorageManager.updateForageKeys())
                .then(() => (this._rwkSyncDone = true));
            }
            if (!this._rwkSyncDone) return false;
          }
          return _isReady.call(this);
        };
      },
    },

    MV: {
      nameOf(savefileId) {
        if (savefileId < 0) return "config";
        if (savefileId === 0) return "global";
        return "file" + savefileId;
      },
      idOf(name) {
        if (name === "config") return -1;
        if (name === "global") return 0;
        const m = /^file(\d+)$/.exec(name);
        return m ? Number(m[1]) : null;
      },
      async listLocal() {
        const names = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key === "RPG Config") names.push("config");
          else if (key === "RPG Global") names.push("global");
          else {
            const m = /^RPG File(\d+)$/.exec(key);
            if (m) names.push("file" + m[1]);
          }
        }
        return names;
      },
      async read(name) {
        const id = this.idOf(name);
        return id === null ? null : localStorage.getItem(StorageManager.webStorageKey(id));
      },
      async write(name, data) {
        const id = this.idOf(name);
        if (id !== null) localStorage.setItem(StorageManager.webStorageKey(id), data);
      },
      async remove(name) {
        const id = this.idOf(name);
        if (id !== null) localStorage.removeItem(StorageManager.webStorageKey(id));
      },
      install(hooks) {
        const self = this;
        const _save = StorageManager.saveToWebStorage;
        StorageManager.saveToWebStorage = function (savefileId) {
          const r = _save.apply(this, arguments);
          hooks.onSave(self.nameOf(savefileId));
          return r;
        };
        const _remove = StorageManager.removeWebStorage;
        StorageManager.removeWebStorage = function (savefileId) {
          const r = _remove.apply(this, arguments);
          hooks.onRemove(self.nameOf(savefileId));
          return r;
        };
        // MV loads config inside Scene_Boot.create, so hold the whole boot.
        const _run = SceneManager.run;
        SceneManager.run = function () {
          const args = arguments;
          hooks
            .boot()
            .catch((e) => console.error("[RWK] boot sync failed", e))
            .then(() => _run.apply(SceneManager, args));
        };
      },
    },
  };

  const adapter = adapters[RWK.engine];

  //---------------------------------------------------------------------------
  // Local sync metadata: { [name]: { etag, dirty, deleted, conflict } }
  //---------------------------------------------------------------------------

  const meta = RWK.storage.get(META_KEY, {});
  const saveMeta = () => RWK.storage.set(META_KEY, meta);
  const entry = (name) => meta[name] || (meta[name] = {});

  //---------------------------------------------------------------------------
  // Transport
  //---------------------------------------------------------------------------

  class AuthExpired extends Error {}

  async function api(method, path, { body, headers = {} } = {}) {
    const res = await fetch("/api/" + path, {
      method,
      body,
      headers: { "x-rwk-device": RWK.deviceId, ...headers },
      credentials: "same-origin",
      cache: "no-store",
      // Uploads carry the whole save, so give slow mobile links more time.
      signal: AbortSignal.timeout ? AbortSignal.timeout(body ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS) : undefined,
      redirect: "manual", // an expired Access session answers with a redirect
    });
    if (res.type === "opaqueredirect" || res.status === 401) throw new AuthExpired();
    return res;
  }

  // Engine save strings are binary strings (charCode <= 255) or plain text.
  function encode(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c > 255) return { enc: "utf8", bytes: new TextEncoder().encode(str) };
      bytes[i] = c;
    }
    return { enc: "latin1", bytes };
  }

  function decode(buffer, enc) {
    const bytes = new Uint8Array(buffer);
    if (enc === "utf8") return new TextDecoder().decode(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  }

  async function download(name) {
    const res = await api("GET", "saves/" + encodeURIComponent(name));
    if (!res.ok) throw new Error("download " + name + ": " + res.status);
    const data = decode(await res.arrayBuffer(), res.headers.get("x-rwk-enc"));
    await adapter.write(name, data);
    meta[name] = { etag: unquote(res.headers.get("etag")) };
    saveMeta();
  }

  // Returns "ok" | "conflict" (with info) | "gone"
  async function upload(name) {
    const m = entry(name);
    const data = await adapter.read(name);
    if (data === null || data === undefined) {
      delete meta[name];
      saveMeta();
      return { status: "gone" };
    }
    const { enc, bytes } = encode(String(data));
    const headers = { "content-type": "application/octet-stream", "x-rwk-enc": enc };
    if (m.etag) headers["if-match"] = m.etag;
    else headers["if-none-match"] = "*";
    const res = await api("PUT", "saves/" + encodeURIComponent(name), { body: bytes, headers });
    if (res.status === 412) {
      const info = await res.json().catch(() => ({}));
      return { status: "conflict", current: info.current };
    }
    if (!res.ok) throw new Error("upload " + name + ": " + res.status);
    const { etag } = await res.json();
    meta[name] = { etag };
    saveMeta();
    return { status: "ok" };
  }

  async function removeRemote(name) {
    const m = entry(name);
    const headers = m.etag ? { "if-match": m.etag } : {};
    const res = await api("DELETE", "saves/" + encodeURIComponent(name), { headers });
    // 412: someone else rewrote it meanwhile -> their copy wins, keep it.
    if (!res.ok && res.status !== 404 && res.status !== 412) throw new Error("delete " + name + ": " + res.status);
    delete meta[name];
    saveMeta();
  }

  function unquote(etag) {
    return etag ? etag.replace(/^W\//, "").replace(/"/g, "") : null;
  }

  //---------------------------------------------------------------------------
  // Boot: reconcile local and cloud before the game reads any save
  //---------------------------------------------------------------------------

  let authLost = false;

  // The game waits for this to finish, so it must never write saves after the
  // engine has read them: network calls time out individually, while dialogs
  // wait for the player as long as needed.
  async function boot() {
    if (!navigator.onLine) {
      RWK.toast("Offline: using this device's saves; they will sync when back online.", "warn", 5000);
      return;
    }
    RWK.toast("☁ Syncing saves…", "info", 0);
    try {
      await reconcile();
    } catch (e) {
      if (e instanceof AuthExpired) {
        authLost = true;
        RWK.toast("Login expired: reload the page to sync saves.", "error", 8000);
      } else {
        console.error("[RWK] boot sync failed", e);
        RWK.toast("Could not sync saves (slow or failed network); using this device's saves.", "warn", 5000);
      }
    }
    // Whatever could not be pushed is retried in the background.
    for (const [name, m] of Object.entries(meta)) if (m.dirty && !m.conflict) pending.add(name);
    if (pending.size) schedule(RETRY_DELAY_MS);
  }

  async function reconcile() {
    const res = await api("GET", "saves");
    if (!res.ok) throw new Error("list: " + res.status);
    const { items } = await res.json();
    const remote = new Map(items.map((i) => [i.name, i]));
    const local = new Set(await adapter.listLocal());

    await warnIfRecentlyUsedElsewhere(items);

    const conflicts = [];
    const pulls = [];
    const pushes = [];
    for (const name of new Set([...remote.keys(), ...local, ...Object.keys(meta)])) {
      const r = remote.get(name);
      const m = meta[name];
      if (m && m.deleted) {
        if (r && r.etag !== m.etag) pulls.push(name); // changed elsewhere: keep theirs
        else pushes.push(name);
        continue;
      }
      if (!local.has(name)) {
        if (r) pulls.push(name);
        else if (m) delete meta[name];
        continue;
      }
      if (!r) {
        pushes.push(name);
      } else if (m && m.etag === r.etag) {
        if (m.dirty) pushes.push(name);
      } else if (m && m.etag && !m.dirty) {
        pulls.push(name); // cloud moved on, local untouched since last sync
      } else {
        conflicts.push({ name, remote: r }); // both sides changed / never synced
      }
    }

    if (conflicts.length) {
      const choice = await askConflict(conflicts);
      for (const c of conflicts) {
        if (choice === "cloud") pulls.push(c.name);
        else {
          meta[c.name] = { etag: c.remote.etag, dirty: true };
          pushes.push(c.name);
        }
      }
    }

    for (const name of pulls) await download(name);
    for (const name of pushes) {
      if (meta[name] && meta[name].deleted) await removeRemote(name);
      else await upload(name);
    }
    saveMeta();
    RWK.toast(pulls.length ? "☁ Downloaded " + pulls.length + " save(s) from the cloud" : "☁ Saves are in sync", "info", 2000);
  }

  async function warnIfRecentlyUsedElsewhere(items) {
    const now = Date.now();
    const recent = items.filter((i) => i.deviceId !== RWK.deviceId && i.deviceId !== "import" && now - i.updatedAt < RECENT_OTHER_DEVICE_MS);
    if (!recent.length) return;
    const latest = recent.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    await RWK.choose(
      "The game may be open on another device",
      `Device “${latest.deviceId}” saved at ${time(latest.updatedAt)}.\n` +
        "If it is still open there, close it so the two devices do not overwrite each other's saves.",
      [{ label: "Got it", value: true, primary: true }]
    );
  }

  function askConflict(conflicts) {
    const lines = conflicts.map((c) => `• ${c.name}: cloud copy saved at ${time(c.remote.updatedAt)} (${c.remote.deviceId})`);
    return RWK.choose(
      "This device's saves differ from the cloud",
      "These saves changed in both places:\n" + lines.join("\n") + "\n\nChoose which copy to keep for all of them:",
      [
        { label: "Keep this device's", value: "local" },
        { label: "Use the cloud's", value: "cloud", primary: true },
      ]
    );
  }

  function time(ms) {
    return new Date(ms).toLocaleString();
  }

  //---------------------------------------------------------------------------
  // Runtime: push every save shortly after the game writes it
  //---------------------------------------------------------------------------

  const pending = new Set();
  let timer = 0;
  let running = false;

  function schedule(delay = PUSH_DELAY_MS) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  async function flush() {
    if (running || authLost || !pending.size) return;
    if (!navigator.onLine) return; // the "online" event resumes
    running = true;
    let synced = 0;
    let retrying = false;
    try {
      for (const name of [...pending]) {
        const m = entry(name);
        if (m.conflict) {
          pending.delete(name);
          continue;
        }
        if (m.deleted) {
          await removeRemote(name);
          pending.delete(name);
          continue;
        }
        const result = await upload(name);
        pending.delete(name);
        if (result.status === "conflict") await resolveRuntimeConflict(name, result.current);
        else if (result.status === "ok") synced++;
      }
      if (synced) RWK.toast("☁ Saved to the cloud", "info", 1500);
    } catch (e) {
      if (e instanceof AuthExpired) {
        authLost = true;
        RWK.toast("Login expired: saves stay on this device. Reload the page to sync.", "error", 8000);
      } else {
        console.warn("[RWK] push failed, retrying later", e);
        RWK.toast("Could not upload the save yet; will retry.", "warn", 3000);
        retrying = true;
        schedule(RETRY_DELAY_MS);
      }
    } finally {
      running = false;
      // Saves made while this flush ran go out shortly; failures wait for the retry.
      if (pending.size && !authLost && !retrying) schedule();
    }
  }

  async function resolveRuntimeConflict(name, current) {
    const when = current ? time(current.updatedAt) + " (" + current.deviceId + ")" : "recently";
    const choice = await RWK.choose(
      "The cloud has a newer save",
      `Save “${name}” was updated in the cloud at ${when}.\nOverwrite it with the save just made on this device?`,
      [
        { label: "Later", value: "later" },
        { label: "Overwrite cloud", value: "overwrite", primary: true },
      ]
    );
    const m = entry(name);
    if (choice === "overwrite" && current) {
      m.etag = current.etag;
      m.dirty = true;
      pending.add(name);
    } else {
      m.conflict = true; // resolved at next boot
    }
    saveMeta();
  }

  function markDirty(name) {
    const m = entry(name);
    m.dirty = true;
    delete m.deleted;
    delete m.conflict;
    saveMeta();
    pending.add(name);
    schedule();
  }

  function markDeleted(name) {
    const m = entry(name);
    m.deleted = true;
    m.dirty = true;
    saveMeta();
    pending.add(name);
    schedule();
  }

  window.addEventListener("online", () => {
    for (const [name, m] of Object.entries(meta)) if (m.dirty && !m.conflict) pending.add(name);
    schedule(500);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  adapter.install({ boot, onSave: markDirty, onRemove: markDeleted });

  RWK.saveSync = { flush, meta };
})();
