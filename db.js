/* ==========================================================================
   Sickboiss Shoe Log — db.js
   Local database layer. Everything lives in the phone's own IndexedDB:
   no server, no login. Each store is keyed by `id` (tags by `serial`).

   Stores
     pairs   one record per shoe
     wears   wear log entries          (pairId, date, km, occasion, memory, source)
     care    maintenance log           (pairId, date, type, detail, cost, by)
     values  market value history      (pairId, date, value, source: manual|scrape)
     photos  compressed JPEG data URLs (pairId, kind: main|progress, date, data)
     tags    NFC tag ↔ pair links      (serial, pairId, claimedAt)
     meta    key/value settings        (displayName, lastBackup, rainMode …)
   ========================================================================== */
window.SB = window.SB || {};

SB.db = (() => {
  const NAME = 'sickboiss-shoelog';
  const VERSION = 1;
  const STORES = {
    pairs: 'id', wears: 'id', care: 'id', values: 'id',
    photos: 'id', tags: 'serial', meta: 'key'
  };
  const BY_PAIR = ['wears', 'care', 'values', 'photos', 'tags'];

  let dbPromise = null;

  /** Open (and on first run, create) the database. */
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, key] of Object.entries(STORES)) {
          if (d.objectStoreNames.contains(name)) continue;
          const os = d.createObjectStore(name, { keyPath: key });
          if (BY_PAIR.includes(name)) os.createIndex('pairId', 'pairId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  const wrap = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const store = async (name, mode = 'readonly') =>
    (await open()).transaction(name, mode).objectStore(name);

  const all = async (name) => wrap((await store(name)).getAll());
  const get = async (name, key) => wrap((await store(name)).get(key));
  const put = async (name, obj) => wrap((await store(name, 'readwrite')).put(obj));
  const del = async (name, key) => wrap((await store(name, 'readwrite')).delete(key));
  const clear = async (name) => wrap((await store(name, 'readwrite')).clear());
  const byPair = async (name, pairId) =>
    wrap((await store(name)).index('pairId').getAll(pairId));

  /** Short unique id. */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  /** Remove a pair and everything attached to it. Linked tags are freed, not deleted. */
  async function deletePair(id) {
    for (const s of ['wears', 'care', 'values', 'photos']) {
      for (const row of await byPair(s, id)) await del(s, row.id);
    }
    for (const t of await byPair('tags', id)) await put('tags', { ...t, pairId: null });
    await del('pairs', id);
  }

  /** Load every store at once — the app works from this snapshot. */
  async function loadAll() {
    const out = {};
    for (const s of Object.keys(STORES)) out[s] = await all(s);
    return out;
  }

  // ---- settings -----------------------------------------------------------
  const getMeta = async (key, fallback = null) => {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  };
  const setMeta = (key, value) => put('meta', { key, value });

  // ---- backup / restore ---------------------------------------------------
  /** Whole collection as one JSON object (photos included as data URLs). */
  async function exportAll() {
    const data = await loadAll();
    return { app: 'sickboiss-shoe-log', version: VERSION, exportedAt: new Date().toISOString(), data };
  }

  /** Replace the whole database with a backup file's contents. */
  async function importAll(backup) {
    if (!backup || backup.app !== 'sickboiss-shoe-log' || !backup.data) {
      throw new Error('This file is not a Sickboiss Shoe Log backup.');
    }
    for (const s of Object.keys(STORES)) {
      await clear(s);
      for (const row of backup.data[s] || []) await put(s, row);
    }
  }

  async function eraseAll() {
    for (const s of Object.keys(STORES)) await clear(s);
  }

  /** Ask the browser not to evict our data under storage pressure. */
  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) { /* not supported */ }
    return false;
  }

  return { open, all, get, put, del, byPair, uid, deletePair, loadAll,
           getMeta, setMeta, exportAll, importAll, eraseAll, persist };
})();
