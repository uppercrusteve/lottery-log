/**
 * 过关组合与奖金。
 *
 * 竞彩是「N 场里挑 M 场组成一注」，每注 2 元。选多种组合就是多组注数，
 * 比如 3串4 = 3 个 2串1 + 1 个 3串1。
 *
 * 奖金 = 每注 2 元 × 该注各场出票 SP 连乘，不乘返奖率（65% 已含在 SP 里），
 * 最后乘倍数。单注封顶 MAX_UNIT。
 */

/** 单注封顶 500 万 */
export const MAX_UNIT = 5000000;

/** 每注 2 元 */
export const UNIT = 2;

/**
 * 过关方式 → 组合大小列表。列表里每个 m 表示"挑 m 场一注"，
 * 注数由 C(总场数, m) 算，不写死。
 */
export const PASS_TYPES = {
  '1x1': [1],
  '2x1': [2],
  '3x1': [3],
  '3x3': [2],
  '3x4': [2, 3],
  '4x1': [4],
  '4x4': [3],
  '4x5': [3, 4],
  '4x6': [2],
  '4x11': [2, 3, 4],
  '5x1': [5],
  '5x5': [4],
  '5x6': [4, 5],
  '5x10': [2],
  '5x11': [2, 5],
  '5x16': [3, 4, 5],
  '5x20': [2, 3],
  '5x26': [2, 3, 4, 5],
  '6x1': [6],
  '6x6': [5],
  '6x7': [5, 6],
  '6x15': [2],
  '6x16': [2, 6],
  '6x20': [3],
  '6x22': [2, 5, 6],
  '6x35': [3, 4],
  '6x42': [3, 4, 5, 6],
  '6x50': [2, 3, 4],
  '6x57': [2, 3, 4, 5, 6],
  '7x1': [7],
  '7x7': [6],
  '7x8': [6, 7],
  '7x21': [5],
  '7x35': [4],
  '7x120': [2, 3, 4, 5, 6, 7],
  '8x1': [8],
  '8x8': [7],
  '8x9': [7, 8],
  '8x28': [6],
  '8x56': [5],
  '8x70': [4],
  '8x247': [2, 3, 4, 5, 6, 7, 8],
};

/** 组合数 C(n, m) */
export function comb(n, m) {
  if (m > n) return 0;
  if (m === 0 || m === n) return 1;
  let r = 1;
  for (let i = 0; i < m; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/**
 * 从 items 里取 size 个的全部组合。
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function combinations(items, size) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === size) return out.push([...acc]);
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * 一种过关方式的总注数。
 * @param {number} legs 场数
 * @param {string} passType
 */
export function betCount(legs, passType) {
  const sizes = PASS_TYPES[passType];
  if (!sizes) return 0;
  return sizes.reduce((n, m) => n + comb(legs, m), 0);
}

/** 票面金额（2 元 × 注数 × 倍数），用于核对录入的 stake */
export function expectedStake(legs, passType, multiple = 1) {
  return UNIT * betCount(legs, passType) * multiple;
}

/**
 * 一个组合的奖金：2 × 各场 SP 连乘，单注封顶。
 * @param {number[]} sps
 */
export function comboAmount(sps) {
  if (sps.some((sp) => !(sp > 0))) return 0;
  const raw = sps.reduce((n, sp) => n * sp, UNIT);
  return Math.min(raw, MAX_UNIT);
}

/**
 * 全票奖金。只算「每场都命中」的组合。
 * @param {{ sp: number }[]} legs
 * @param {boolean[]} hits 与 legs 同序
 * @param {string} passType
 * @param {number} multiple
 * @returns {{ hits: number, amount: number }} hits 为命中注数
 */
export function parlayAmount(legs, hits, passType, multiple = 1) {
  const sizes = PASS_TYPES[passType];
  if (!sizes) return { hits: 0, amount: 0 };

  const idx = legs.map((_, i) => i);
  let count = 0;
  let total = 0;

  for (const m of sizes) {
    for (const group of combinations(idx, m)) {
      if (!group.every((i) => hits[i])) continue;
      count++;
      total += comboAmount(group.map((i) => legs[i].sp));
    }
  }

  return { hits: count, amount: Math.round(total * multiple * 100) / 100 };
}
