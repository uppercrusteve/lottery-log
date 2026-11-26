/**
 * 双色球奖级表。
 *
 * 来源：《中国福利彩票"双色球"游戏规则》第五章第二十四条
 *   https://cwlgovcn.com/c/2018/10/12/417937.shtml
 * 第十六条确认固定奖：三等奖 3000、四等奖 200、五等奖 10、六等奖 5，
 * 一、二等奖为浮动奖，按当期销量分配、单注封顶 500 万。
 *
 * 第二十四条原文的六等奖只要求"与 1 个蓝色球号码相同"，红球数量不限；
 * 但第二十五条以外的兼中处理按最高奖级取一次，所以下面的表按 (红中, 蓝中) 全覆盖。
 *
 * 交叉核对：2026-11-24 第 2026135 期开奖号 02 10 16 22 26 30 + 08，
 * 官方 pricemoney 六等奖 5 元，与本表一致。
 */

/** @type {Array<[number, number, 0|1|2|3|4|5|6]>} [红中, 蓝中, 奖级]，奖级 0 = 没中 */
const TABLE = [
  [6, 1, 1],
  [6, 0, 2],
  [5, 1, 3],
  [5, 0, 4],
  [4, 1, 4],
  [4, 0, 5],
  [3, 1, 5],
  [2, 1, 6],
  [1, 1, 6],
  [0, 1, 6],
];

const INDEX = new Map(TABLE.map(([r, b, lv]) => [`${r},${b}`, lv]));

/**
 * @param {number} redHit
 * @param {number} blueHit
 * @returns {0|1|2|3|4|5|6}
 */
export function levelOf(redHit, blueHit) {
  return INDEX.get(`${redHit},${blueHit}`) ?? 0;
}

/** 固定奖金额，浮动奖（1、2 等）返回 null */
export const FIXED_PRIZE = { 3: 3000, 4: 200, 5: 10, 6: 5 };

/** 一注号码是否合法 */
export function isValid(nums) {
  const { red = [], blue = [] } = nums;
  const okSet = (arr, count, max) =>
    arr.length === count &&
    arr.every((n) => Number.isInteger(n) && n >= 1 && n <= max) &&
    new Set(arr).size === count;
  return okSet(red, 6, 33) && okSet(blue, 1, 16);
}
