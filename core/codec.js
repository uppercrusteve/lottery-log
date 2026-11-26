/**
 * 分片编解码与 schema 迁移。
 *
 * 数据按天分片：tickets/YYYY-MM-DD.json 与 draws/YYYY-MM-DD.json。
 * 分片而不是单文件，是为了两台手机改不同日期时不会互相覆盖。
 *
 * 迁移规则：schema 整数单调递增，read* 负责把老版本升到当前版本，
 * 不认识的更高版本直接报错，不猜。当前版本 2（v2 加竞彩 legs）。
 */

import * as ssq from './rules/ssq.js';
import * as dlt from './rules/dlt.js';
import { PASS_TYPES } from './rules/pass.js';
import { marketsOf, needsLine } from './rules/jc.js';
import { GAMES } from './models.js';

export const SCHEMA = 2;
const RULES = { ssq, dlt };

export const isParlay = (t) => t?.kind === 'parlay' || Array.isArray(t?.legs);

export const ticketPath = (date) => `tickets/${date}.json`;
export const drawPath = (date) => `draws/${date}.json`;

/** 分片外壳。removed 是墓碑，记被删掉的票 id，防止合并时又被并回来 */
const envelope = (kind, date, items, removed = []) => ({ schema: SCHEMA, kind, date, items, removed });

/**
 * 校验一张票，返回问题数组，空数组表示通过。
 * @param {import('./models.js').Ticket} t
 */
export function validateTicket(t) {
  const errs = [];
  if (!t?.id) errs.push('缺 id');
  if (!GAMES[t?.game]) errs.push(`未知彩种：${t?.game}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t?.date ?? '')) errs.push(`日期不是 YYYY-MM-DD：${t?.date}`);
  if (isParlay(t)) {
    errs.push(...validateParlay(t));
  } else if (RULES[t?.game] && !RULES[t.game].isValid(t)) {
    errs.push('号码不合法');
  }
  if (!(typeof t?.stake === 'number' && t.stake > 0)) errs.push(`金额非法：${t?.stake}`);
  if (t?.multiple != null && !(Number.isInteger(t.multiple) && t.multiple >= 1)) {
    errs.push(`倍数非法：${t.multiple}`);
  }
  return errs;
}

/**
 * 一注号码展示串，如 "01 02 03 ... + 07"
 * @param {{ red?: number[], blue?: number[] }} t
 */
export const formatNumbers = (t) =>
  `${(t.red ?? []).map(pad2).join(' ')} + ${(t.blue ?? []).map(pad2).join(' ')}`.trim();

const pad2 = (n) => String(n).padStart(2, '0');

/** 竞彩一场蒸成稳定形状 */
function normalizeLeg(l) {
  return {
    matchId: String(l.matchId),
    ...(l.matchNum ? { matchNum: String(l.matchNum) } : {}),
    ...(l.league ? { league: String(l.league) } : {}),
    ...(l.home ? { home: String(l.home) } : {}),
    ...(l.away ? { away: String(l.away) } : {}),
    market: String(l.market),
    selection: String(l.selection),
    ...(l.line != null ? { line: Number(l.line) } : {}),
    sp: Number(l.sp),
  };
}

/** 竞彩票的额外校验 */
function validateParlay(t) {
  const errs = [];
  const legs = Array.isArray(t.legs) ? t.legs : [];
  if (!legs.length) errs.push('竞彩票没有场次');

  const markets = marketsOf(t.game);
  const ids = new Set();
  legs.forEach((l, i) => {
    const at = `第 ${i + 1} 场`;
    if (!l?.matchId) errs.push(`${at}缺 matchId`);
    else if (ids.has(l.matchId)) errs.push(`${at} matchId 重复`);
    else ids.add(l.matchId);
    if (!markets.includes(l?.market)) errs.push(`${at} 玩法不属于 ${t.game}：${l?.market}`);
    if (!l?.selection) errs.push(`${at} 缺选项`);
    if (!(l?.sp > 1)) errs.push(`${at} 赔率非法：${l?.sp}`);
    if (needsLine(l?.market) && !Number.isFinite(l?.line)) errs.push(`${at} 缺盘口`);
    if (l?.market === 'rqspf' && !Number.isInteger(l?.line)) errs.push(`${at} 足球让球必须是整数`);
  });

  if (!PASS_TYPES[t.passType]) errs.push(`未知过关方式：${t.passType}`);
  else if (PASS_TYPES[t.passType].some((m) => m > legs.length)) {
    errs.push(`过关方式 ${t.passType} 需要至少 ${PASS_TYPES[t.passType][0]} 场，只有 ${legs.length} 场`);
  }
  return errs;
}

/** 把一张票据蒸成稳定形状，丢掉未知字段 */
export function normalizeTicket(t) {
  if (isParlay(t)) {
    return {
      id: String(t.id),
      kind: 'parlay',
      game: t.game,
      date: t.date,
      legs: (t.legs ?? []).map(normalizeLeg),
      passType: t.passType,
      stake: t.stake,
      ...(t.multiple && t.multiple !== 1 ? { multiple: t.multiple } : {}),
      ...(t.shop ? { shop: t.shop } : {}),
      ...(t.note ? { note: t.note } : {}),
      createdAt: t.createdAt ?? new Date().toISOString(),
    };
  }
  return {
    id: String(t.id),
    kind: 'number',
    game: t.game,
    date: t.date,
    red: [...(t.red ?? [])].sort((a, b) => a - b),
    blue: [...(t.blue ?? [])].sort((a, b) => a - b),
    stake: t.stake,
    ...(t.added ? { added: true } : {}),
    ...(t.multiple && t.multiple !== 1 ? { multiple: t.multiple } : {}),
    ...(t.shop ? { shop: t.shop } : {}),
    ...(t.note ? { note: t.note } : {}),
    createdAt: t.createdAt ?? new Date().toISOString(),
  };
}

/**
 * 生成票单分片文本。
 * @param {string} date
 * @param {import('./models.js').Ticket[]} tickets
 * @param {string[]} [removed] 墓碑 id
 */
export function writeTickets(date, tickets, removed = []) {
  return `${JSON.stringify(envelope('tickets', date, tickets.map(normalizeTicket), removed), null, 2)}\n`;
}

/**
 * 生成开奖分片文本。
 * @param {string} date
 * @param {import('./models.js').Draw[]} draws
 */
export function writeDraws(date, draws) {
  return `${JSON.stringify(envelope('draws', date, draws), null, 2)}\n`;
}

/**
 * 解析 JSON 文本，失败给空壳而不是抛。
 * @param {string | undefined} text
 */
export function parseShard(text) {
  if (!text) return { schema: 0, items: [], removed: [] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { schema: 0, items: [], removed: [], error: '不是合法 JSON' };
  }
  if (!raw || typeof raw !== 'object') return { schema: 0, items: [], removed: [], error: '分片不是对象' };

  const schema = Number(raw.schema ?? 0);
  if (schema > SCHEMA) {
    return { schema, items: [], removed: [], error: `schema ${schema} 比程序支持的 ${SCHEMA} 新` };
  }

  const removed = Array.isArray(raw.removed) ? raw.removed.map(String) : [];
  let items = Array.isArray(raw.items) ? raw.items : [];
  if (schema < 1) items = items.map(migrate0to1);
  if (schema < 2) items = items.map(migrate1to2);

  return { schema, items, removed };
}

/** v1 → v2：旧票都是数字彩，补 kind。draws 分片没有 kind，靠 status 区分 */
function migrate1to2(t) {
  if (t?.kind || t?.status) return t;
  return { ...t, kind: Array.isArray(t.legs) ? 'parlay' : 'number' };
}

/** v0（无 schema 字段，裸数组）→ v1 */
function migrate0to1(t) {
  return {
    ...t,
    stake: t.stake ?? 2,
    game: t.game ?? 'ssq',
    createdAt: t.createdAt ?? `${t.date}T00:00:00.000Z`,
  };
}

/**
 * 合并两张同日的票单分片。墓碑取并集且优先，未被删的按 id 去重、后到的覆盖。
 * @param {{ items?: any[], removed?: string[] }} remote
 * @param {{ items?: any[], removed?: string[] }} local
 */
export function mergeShards(remote, local) {
  const removed = [...new Set([...(remote.removed ?? []), ...(local.removed ?? [])])];
  const gone = new Set(removed);
  const map = new Map();
  for (const t of [...(remote.items ?? []), ...(local.items ?? [])]) map.set(t.id, t);
  const items = [...map.values()]
    .filter((t) => !gone.has(t.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { items, removed };
}
