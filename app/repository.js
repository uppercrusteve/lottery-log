/**
 * 编排层：把存储、编解码、判定串起来，UI 只调这里。
 *
 * 两台设备同改一天时：先写本地（不丢），再推远程；远程 409 就重读、按 id 合并、重推。
 * 合并以 id 为准，同 id 后写覆盖，不同 id 并存。
 */

import * as codec from '../core/codec.js';
import { evaluate, summarize, costOf } from '../core/verdict.js';
import { ConflictError } from '../adapters/store/github.js';

const MAX_PUSH_TRIES = 3;

/**
 * @param {object} deps
 * @param {import('../adapters/store/contract.js').TicketStore} deps.local
 * @param {import('../adapters/store/contract.js').TicketStore} deps.remote
 * @param {ReturnType<typeof import('../adapters/store/idb.js').outbox>} [deps.queue]
 */
export function repository({ local, remote, queue }) {
  /** 离线或接口抽风时当远端没有，别把整个刷新打挂 */
  const tryRemote = async (fn) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };

  async function loadTickets(date) {
    const localText = await local.readTicketShard(date);
    const remoteText = await tryRemote(() => remote.readTicketShard(date));
    // 远端可能带着别处的改动，按 id 并集、removed 优先，本地同 id 覆盖
    if (!remoteText) return codec.parseShard(localText).items;
    const merged = codec.mergeShards(codec.parseShard(remoteText), codec.parseShard(localText));
    return merged.items;
  }

  /** 赛程只由 Actions 写，本地只是缓存 */
  async function loadMatches(date) {
    const text =
      (await tryRemote(() => remote.readMatchShard(date))) ?? (await local.readMatchShard(date));
    return codec.parseShard(text).items;
  }

  async function loadDraw(date) {
    const text =
      (await tryRemote(() => remote.readDrawShard(date))) ?? (await local.readDrawShard(date));
    return codec.parseShard(text).items;
  }

  /**
   * 记一张票。先本地落盘，再尽力推远程；推不动就进队列，返回 offline 标记。
   * @param {import('../core/models.js').Ticket} ticket
   * @param {{ offline?: boolean }} [opts]
   */
  async function addTicket(ticket, { offline = false } = {}) {
    const errs = codec.validateTicket(ticket);
    if (errs.length) throw new Error(errs.join('；'));

    const next = codec.normalizeTicket(ticket);
    // 只合本地：远程由 push 里的合并处理，避免一次没网就写不进去
    const shard = codec.parseShard(await local.readTicketShard(next.date));
    const merged = codec.mergeShards(shard, { items: [next] });
    await local.writeTicketShard(next.date, codec.writeTickets(next.date, merged.items, merged.removed));

    return push(next.date, next, { offline });
  }

  /** 删一张票，落墓碑，免得合并时被并回来 */
  async function removeTicket(id, date) {
    const shard = codec.parseShard(await local.readTicketShard(date));
    const remaining = shard.items.filter((t) => t.id !== id);
    const removed = [...new Set([...shard.removed, id])];
    await local.writeTicketShard(date, codec.writeTickets(date, remaining, removed));
    return push(date, { removed: id }, { offline: false });
  }

  /**
   * 推某一天到远程，冲突就合并重来。
   * @param {string} date
   * @param {{ removed?: string }} _marker
   * @param {{ offline: boolean }} opts
   */
  async function push(date, _marker, { offline } = { offline: false }) {
    if (offline) {
      await queue?.add(`tickets/${date}.json`);
      return { pushed: false, reason: '离线' };
    }

    for (let attempt = 1; attempt <= MAX_PUSH_TRIES; attempt++) {
      try {
        const localText = await local.readTicketShard(date);
        if (!localText) throw new Error(`本地没有 ${date} 的票单分片`);

        const remoteText = await remote.readTicketShard(date);
        const merged = codec.mergeShards(codec.parseShard(remoteText), codec.parseShard(localText));
        const out = codec.writeTickets(date, merged.items, merged.removed);

        await remote.writeTicketShard(date, out);
        await local.writeTicketShard(date, out);
        await queue?.remove(`tickets/${date}.json`);
        return { pushed: true, attempts: attempt };
      } catch (e) {
        if (e instanceof ConflictError && attempt < MAX_PUSH_TRIES) continue;
        if (attempt >= MAX_PUSH_TRIES || !(e instanceof ConflictError)) {
          await queue?.add(`tickets/${date}.json`);
          return { pushed: false, reason: e.message, error: e };
        }
      }
    }
    return { pushed: false, reason: '超出重试次数' };
  }

  /**
   * 时间线：按日期倒序列出票 + 判定。
   * @param {{ limit?: number }} [opts]
   */
  async function timeline({ limit = 120 } = {}) {
    const dates = (await local.listTicketDates()).slice(0, limit);
    const rows = [];

    for (const date of dates) {
      const [tickets, draws] = await Promise.all([loadTickets(date), loadDraw(date)]);
      // 购买日通常当天或次日开奖，两天内的开奖都拿来对
      const byGame = new Map(draws.map((d) => [d.game, d]));
      const nextDraws = await loadDraw(addDays(date, 1));
      for (const d of nextDraws) if (!byGame.has(d.game)) byGame.set(d.game, d);

      for (const t of tickets) {
        const v = evaluate(t, byGame.get(t.game));
        rows.push({ ticket: t, verdict: v, cost: costOf(t) });
      }
    }
    return rows;
  }

  /** 按日汇总，给顶部数字 */
  async function stats() {
    const rows = await timeline({ limit: 400 });
    const verdicts = rows.map((r) => r.verdict);
    const s = summarize(verdicts);
    const spent = rows.reduce((n, r) => n + r.cost, 0);
    return { ...s, spent, net: s.payout - spent };
  }

  return { addTicket, removeTicket, timeline, stats, push, loadDraw, loadMatches };
}

export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
