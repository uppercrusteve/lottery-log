/**
 * 票单与判定的数据模型。
 *
 * 这一层刻意不依赖 DOM、网络、存储和框架，账本应用可以直接引。
 * 一期只有数字彩（kind: 'number'）；竞彩（kind: 'parlay'）在二期加，
 * 字段位置已经预留，加的时候不改既有结构。
 *
 * @typedef {'ssq' | 'dlt'} GameId  双色球 / 大乐透
 */

/** 双色球：红 6/33 + 蓝 1/16；大乐透：前 5/35 + 后 2/12 */
export const GAMES = {
  ssq: {
    id: 'ssq',
    name: '双色球',
    redCount: 6,
    redMax: 33,
    blueCount: 1,
    blueMax: 16,
    drawDays: [2, 4, 0], // 周二、四、日
  },
  dlt: {
    id: 'dlt',
    name: '大乐透',
    frontCount: 5,
    frontMax: 35,
    backCount: 2,
    backMax: 12,
    drawDays: [1, 3, 6], // 周一、三、六
  },
};

/**
 * @typedef {object} Ticket
 * @property {string} id            稳定 id，写入时生成，重推不变
 * @property {GameId} game
 * @property {string} date          YYYY-MM-DD，购买日（本地时区）
 * @property {number[]} red         双色球红球 / 大乐透前区，升序去重
 * @property {number[]} blue        双色球蓝球 / 大乐透后区，升序去重
 * @property {number} stake         元
 * @property {boolean} [added]      大乐透追加，仅对一、二等奖生效
 * @property {number} [multiple]    倍投，默认 1
 * @property {string} [shop]        购买站点，可选
 * @property {string} [note]
 * @property {string} createdAt     ISO 时间戳
 */

/**
 * @typedef {object} Draw
 * @property {GameId} game
 * @property {string} issue         期号
 * @property {string} date          YYYY-MM-DD，开奖日
 * @property {number[]} red
 * @property {number[]} blue
 * @property {'ok' | 'pending'} status
 * @property {string} [source]      来源 URL
 * @property {string} [fetchedAt]   ISO 抓取时间
 * @property {Record<number, number>} [prizeTable] 奖级 → 该期单注奖金（浮动奖用）
 * @property {number} [pool]        奖池余额，决定大乐透固定奖档位
 */

/**
 * 一注的判定结果。level 为 0 表示没中。
 * @typedef {object} Verdict
 * @property {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7} level
 * @property {number} amount        元，未中为 0
 * @property {number} redHit
 * @property {number} blueHit
 * @property {boolean} pending      开奖未落地
 * @property {string} [reason]      pending 或异常原因
 */

/** 大乐透奖池达到 8 亿后固定奖上浮，档位分界 */
export const DLT_POOL_HIGH = 800000000;

/** 一注 2 元，追加 +1 元 */
export const UNIT_PRICE = 2;
export const ADD_PRICE = 1;
