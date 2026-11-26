/**
 * 判定：一张票对一个开奖，出奖级和金额。
 *
 * 纯函数，不读时间、不碰网络。所有金额单位都是元。
 * 高奖级（双色球一/二等、大乐透一/二等）当期金额只能取官方公布值，
 * 拿不到就返回 amount: null 并标 reason，绝不猜。
 */

import * as ssq from './rules/ssq.js';
import * as dlt from './rules/dlt.js';
import { settleLeg } from './rules/jc.js';
import { parlayAmount } from './rules/pass.js';
import { DLT_POOL_HIGH, ADD_PRICE, kindOf } from './models.js';

const RULES = { ssq, dlt };

/**
 * @param {import('./models.js').Ticket} ticket
 * @param {import('./models.js').Draw | undefined} draw
 * @returns {import('./models.js').Verdict}
 */
export function evaluate(ticket, draw) {
  if (kindOf(ticket) === 'parlay') return evaluateParlay(ticket, draw?.results);

  const base = { level: 0, amount: 0, redHit: 0, blueHit: 0, pending: false };

  if (!draw || draw.status !== 'ok') {
    return { ...base, pending: true, reason: draw?.status === 'pending' ? '开奖未落地' : '缺开奖记录' };
  }
  if (draw.game !== ticket.game) {
    return { ...base, pending: true, reason: `彩种不符：票 ${ticket.game} / 开奖 ${draw.game}` };
  }

  const rule = RULES[ticket.game];
  if (!rule) {
    return { ...base, pending: true, reason: `未知彩种 ${ticket.game}` };
  }

  const redHit = countHit(ticket.red, draw.red);
  const blueHit = countHit(ticket.blue, draw.blue);
  const level = rule.levelOf(redHit, blueHit);

  if (level === 0) return { ...base, redHit, blueHit };

  const amount = computeAmount(ticket, draw, level);
  const multiple = ticket.multiple ?? 1;

  return {
    level,
    redHit,
    blueHit,
    pending: false,
    amount: amount == null ? null : round2(amount * multiple),
    ...(amount == null ? { reason: '浮动奖，缺当期金额' } : {}),
  };
}

/**
 * 竞彩过关判定。
 *
 * 任一场未结算就整票 pending——混合过关里不同组合依赖的场次不一样，
 * 部分出结果时先算金额会让人误以为板上钉钉。
 *
 * @param {import('./models.js').Ticket} ticket
 * @param {Record<string, object> | undefined} results matchId → 赛果
 * @returns {import('./models.js').Verdict}
 */
export function evaluateParlay(ticket, results) {
  const legs = ticket.legs ?? [];
  const base = { level: 0, amount: 0, bets: 0, pending: false, legs: [] };

  if (!legs.length) return { ...base, pending: true, reason: '票面没有场次' };

  const table = results ?? {};
  const settled = legs.map((leg) => settleLeg(leg, table[leg.matchId]));
  const marks = legs.map((leg, i) => ({
    matchId: leg.matchId,
    market: leg.market,
    selection: leg.selection,
    hit: settled[i],
  }));

  if (settled.some((s) => s === 'pending')) {
    return { ...base, pending: true, reason: '有场次未结算', legs: marks };
  }

  const hits = settled.map((s) => s === 'hit');
  const { hits: bets, amount } = parlayAmount(legs, hits, ticket.passType, ticket.multiple ?? 1);

  return { ...base, level: bets > 0 ? 1 : 0, bets, amount, pending: false, legs: marks };
}

/**
 * 单注奖金。固定奖查表；浮动奖取当期公布值。
 * @returns {number | null} null 表示金额未知
 */
function computeAmount(ticket, draw, level) {
  if (ticket.game === 'ssq') {
    if (level >= 3) return ssq.FIXED_PRIZE[level] ?? null;
    return draw.prizeTable?.[level] ?? null;
  }

  if (ticket.game === 'dlt') {
    if (level <= 2) {
      const basic = draw.prizeTable?.[level];
      if (basic == null) return null;
      // 追加只加浮动奖，80%
      return ticket.added ? basic * (1 + dlt.ADDED_RATE) : basic;
    }
    const table = (draw.pool ?? 0) >= DLT_POOL_HIGH ? dlt.FIXED_PRIZE_HIGH : dlt.FIXED_PRIZE_LOW;
    return table[level] ?? null;
  }

  return null;
}

/**
 * 交集大小。
 * @param {number[]} mine
 * @param {number[]} drawn
 */
export function countHit(mine = [], drawn = []) {
  const s = new Set(drawn);
  return mine.reduce((n, x) => n + (s.has(x) ? 1 : 0), 0);
}

/** 一张票的成本：数字彩按单注价×倍数，竞彩 stake 就是整票面额 */
export function costOf(ticket) {
  const multiple = ticket.multiple ?? 1;
  if (ticket.kind === 'parlay') return ticket.stake || 0;
  return (ticket.stake || 2) * multiple + (ticket.added ? ADD_PRICE * multiple : 0);
}

/**
 * 汇总一批判定，给时间线顶部用。
 * @param {import('./models.js').Verdict[]} verdicts
 */
export function summarize(verdicts) {
  return {
    count: verdicts.length,
    won: verdicts.filter((v) => v.level > 0).length,
    pending: verdicts.filter((v) => v.pending).length,
    payout: verdicts.reduce((n, v) => n + (v.amount ?? 0), 0),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
