/**
 * GitHub Contents API 存储。数据落在私有仓，token 走 Authorization 头。
 *
 * 浏览器直连已实测可行：api.github.com 的预检放行 `*` 源和 Authorization 头。
 *
 * token 要求：fine-grained PAT，只授一个数据仓，contents 读写，其他权限全关。
 * token 只进内存和 IndexedDB，绝不进 URL。
 *
 * 并发：PUT 带 sha，他人先改会 409。这里不自己重试，抛 ConflictError 交给上层
 * 重新读、合并、再写，避免覆盖掉另一台设备的票。
 */

const API = 'https://api.github.com';

export class ConflictError extends Error {
  constructor(path) {
    super(`分片已被别处改动，需重读后合并：${path}`);
    this.name = 'ConflictError';
    this.path = path;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {() => Promise<string>} opts.getToken  每次调用取，便于改凭据后立即生效
 * @param {string} [opts.branch]
 * @returns {import('./contract.js').TicketStore}
 */
export function githubStore({ owner, repo, getToken, branch = 'main' }) {
  const repoPath = `/repos/${owner}/${repo}/contents`;
  const shaCache = new Map();

  async function headers(extra = {}) {
    const token = await getToken();
    if (!token) throw new Error('没有 GitHub 凭据');
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
  }

  async function readRaw(path) {
    const res = await fetch(`${API}${repoPath}/${path}?ref=${branch}`, {
      headers: await headers({ Accept: 'application/vnd.github.raw' }),
    });
    if (res.status === 404) return undefined;
    if (res.status === 401) throw new Error('凭据无效或已过期');
    if (res.status === 403) throw new Error('凭据权限不足（需要该仓 contents 读写）');
    if (!res.ok) throw new Error(`读取 ${path} 失败：${res.status}`);
    return res.text();
  }

  async function writeRaw(path, text, message) {
    // 每次写入前取最新 sha，缓存只用于省一次请求，409 时整体重来
    let sha = shaCache.get(path);
    if (sha === undefined) {
      const head = await fetch(`${API}${repoPath}/${path}?ref=${branch}`, { headers: await headers() });
      if (head.ok) {
        const meta = await head.json();
        sha = meta.sha;
        shaCache.set(path, sha);
      } else if (head.status !== 404) {
        throw new Error(`取 ${path} 的 sha 失败：${head.status}`);
      }
    }

    const res = await fetch(`${API}${repoPath}/${path}`, {
      method: 'PUT',
      headers: await headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message,
        content: b64(text),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.status === 409 || res.status === 422) {
      shaCache.delete(path);
      throw new ConflictError(path);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`写入 ${path} 失败：${res.status} ${body.slice(0, 200)}`);
    }
    const out = await res.json();
    shaCache.set(path, out.content.sha);
  }

  return {
    async readTicketShard(date) {
      return readRaw(`tickets/${date}.json`);
    },
    async writeTicketShard(date, text) {
      const path = `tickets/${date}.json`;
      await writeRaw(path, text, `tickets: ${date}`);
    },
    async readDrawShard(date) {
      return readRaw(`draws/${date}.json`);
    },
    async writeDrawShard(date, text) {
      const path = `draws/${date}.json`;
      await writeRaw(path, text, `draws: ${date}`);
    },
    async listTicketDates() {
      const res = await fetch(`${API}${repoPath}/tickets?ref=${branch}`, { headers: await headers() });
      if (res.status === 404) return []; // 目录还没建
      if (!res.ok) throw new Error(`列目录失败：${res.status}`);
      const list = await res.json();
      return list
        .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name)?.[1])
        .filter(Boolean)
        .sort()
        .reverse();
    },
  };
}

/** UTF-8 安全的 base64，避免 btoa 在中文上炸 */
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
