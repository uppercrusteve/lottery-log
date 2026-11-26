/**
 * 大乐透奖级表：七个奖级。
 *
 * 来源：《超级大乐透游戏规则》第五章第二十五条
 *   https://www.lottery.gov.cn/bzzx/yxgz/20191119/1002858.html
 * 同站《超级大乐透-奖级设置》给出奖池 8 亿上下的两档固定奖
 *   https://www.lottery.gov.cn/bzzx/yxgz/20191206/10000033.html
 *
 * 关于"七级还是九级"：网上大量二手源（维基、百科、部分媒体）在传九级制、
 * 三等奖 10000 元，那是 2019 年以前的旧规。现行为七级制，实证如下——
 * 2026-11-25 第 26135 期官方接口返回的 prizeLevelList 只有
 * 一等奖 9146014 / 二等奖 149283 / 三等奖 5000 / 四等奖 300 / 五等奖 150 /
 * 六等奖 15 / 七等奖 5，对应奖池 7.86 亿的低档。
 * 本表以实开数据为准。
 *
 * 追加投注仅对一、二等奖（浮动奖）生效，为基本奖金 80%；
 * 高奖级金额一律以当期官方公布为准，不在此表内。
 */

/** @type {Array<[number, number, 0|1|2|3|4|5|6|7]>} [前区中, 后区中, 奖级]，0 = 没中 */
const TABLE = [
  [5, 2, 1],
  [5, 1, 2],
  [5, 0, 3],
  [4, 2, 3],
  [4, 1, 4],
  [4, 0, 5],
  [3, 2, 5],
  [3, 1, 6],
  [2, 2, 6],
  [3, 0, 7],
  [2, 1, 7],
  [1, 2, 7],
  [0, 2, 7],
];

const INDEX = new Map(TABLE.map(([f, b, lv]) => [`${f},${b}`, lv]));

/**
 * @param {number} frontHit
 * @param {number} backHit
 * @returns {0|1|2|3|4|5|6|7}
 */
export function levelOf(frontHit, backHit) {
  return INDEX.get(`${frontHit},${backHit}`) ?? 0;
}

/** 奖池低于 8 亿的固定奖 */
export const FIXED_PRIZE_LOW = { 3: 5000, 4: 300, 5: 150, 6: 15, 7: 5 };

/** 奖池达到 8 亿的固定奖 */
export const FIXED_PRIZE_HIGH = { 3: 6666, 4: 380, 5: 200, 6: 18, 7: 7 };

/** 追加投注只加浮动奖（1、2），比例 80% */
export const ADDED_RATE = 0.8;

/** 一注号码是否合法 */
export function isValid(nums) {
  const { red = [], blue = [] } = nums;
  const okSet = (arr, count, max) =>
    arr.length === count &&
    arr.every((n) => Number.isInteger(n) && n >= 1 && n <= max) &&
    new Set(arr).size === count;
  return okSet(red, 5, 35) && okSet(blue, 2, 12);
}
