/**
 * 凭据存放。fine-grained PAT 只存本机 IndexedDB，不上传任何地方。
 *
 * 换来换去的人（比如换手机、吊销重发）走 set/clear。
 */

const DB_NAME = 'lottery-log';
const STORE = 'meta';
const KEYS = { token: 'gh_token', owner: 'gh_owner', repo: 'gh_repo' };

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shards')) db.createObjectStore('shards');
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(key) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const r = t.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

async function set(key, value) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(value, key);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const creds = {
  token: () => get(KEYS.token),
  owner: () => get(KEYS.owner),
  repo: () => get(KEYS.repo),

  /**
   * @param {{ token: string, owner: string, repo: string }} c
   */
  async save({ token, owner, repo }) {
    await set(KEYS.token, token.trim());
    await set(KEYS.owner, owner.trim());
    await set(KEYS.repo, repo.trim());
  },

  /** 一键清除，换机或吊销后调用 */
  async clear() {
    await set(KEYS.token, '');
    await set(KEYS.owner, '');
    await set(KEYS.repo, '');
  },

  async has() {
    return Boolean(await get(KEYS.token));
  },
};
