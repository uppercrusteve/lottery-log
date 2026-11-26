/**
 * IndexedDB 镜像存储。断网时全落这里，联网后由 sync 推给 GitHub。
 *
 * 与 githubStore 同接口，所以 UI 可以在两者间无感切换。
 * 存的是原始分片文本，key 就是路径，方便和远程一一对应。
 */

const DB_NAME = 'lottery-log';
const DB_VER = 1;
const STORE = 'shards';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      try {
        out = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const get = (key) => tx('readonly', (s) => s.get(key));
const put = (key, val) => tx('readwrite', (s) => s.put(val, key));
const del = (key) => tx('readwrite', (s) => s.delete(key));

/** @returns {import('./contract.js').TicketStore & { pendingWrites: () => Promise<string[]> }} */
export function idbStore() {
  return {
    async readTicketShard(date) {
      return get(`tickets/${date}.json`);
    },
    async writeTicketShard(date, text) {
      await put(`tickets/${date}.json`, text);
    },
    async readMatchShard(date) {
      return get(`matches/${date}.json`);
    },
    async readDrawShard(date) {
      return get(`draws/${date}.json`);
    },
    async writeDrawShard(date, text) {
      await put(`draws/${date}.json`, text);
    },
    async listTicketDates() {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      return (keys ?? [])
        .map((k) => /^tickets\/(\d{4}-\d{2}-\d{2})\.json$/.exec(k)?.[1])
        .filter(Boolean)
        .sort()
        .reverse();
    },
    async clear() {
      await tx('readwrite', (s) => s.clear());
    },
  };
}

/** 单独的队列，记下还没推上去的路径 */
export function outbox() {
  const KEY = 'outbox';
  return {
    async add(path) {
      const list = (await get(KEY)) ?? [];
      if (!list.includes(path)) await put(KEY, [...list, path]);
    },
    async remove(path) {
      const list = (await get(KEY)) ?? [];
      await put(KEY, list.filter((p) => p !== path));
    },
    async all() {
      return (await get(KEY)) ?? [];
    },
    async clear() {
      await del(KEY);
    },
  };
}
