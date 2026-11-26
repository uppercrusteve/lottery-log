/**
 * 票单与判定的数据模型。
 *
 * 这一层刻意不依赖 DOM、网络、存储和框架，账本应用可以直接引。
 * 一期只有数字彩（kind: 'number'）；竞彩（kind: 'parlay'）在二期加，
 * 字段位置已经预留，加的时候不改既有结构。
 *
 * @typedef {'ssq' | 'dlt'} GameId  双色球 / 大乐透
 */

/** 双色球：红 6/33 + 蓝 1/16；大乐透：前 5/35 + 后 2/12；jcf/jcb 为竞彩，走 legs 不走球 */
export const GAMES = {
  ssq: {
    id: 'ssq',
    kind: 'number',
    name: '双色球',
    redCount: 6,
    redMax: 33,
    blueCount: 1,
    blueMax: 16,
    drawDays: [2, 4, 0], // 周二、四、日
  },
  dlt: {
    id: 'dlt',
    kind: 'number',
    name: '大乐透',
    frontCount: 5,
    frontMax: 35,
    backCount: 2,
    backMax: 12,
    drawDays: [1, 3, 6], // 周一、三、六
  },
  jcf: {
    id: 'jcf',
    kind: 'parlay',
    name: '竞彩足球',
    drawDays: [0, 1, 2, 3, 4, 5, 6],
  },
  jcb: {
    id: 'jcb',
    kind: 'parlay',
    name: '竞彩篮球',
    drawDays: [0, 1, 2, 3, 4, 5, 6],
  },
};

/**
 * 竞彩一场。summary 只是给人看的缓存，结算只认 matchId。
 * @typedef {object} Leg
 * @property {string} matchId   官方赛事 id，结算主键
 * @property {string} [matchNum] 周三011 这类期号
 * @property {string} [league]
 * @property {string} [home]
 * @property {string} [away]
 * @property {string} market    玩法，见 rules/jc.js
 * @property {string} selection 选项编码
 * @property {number} [line]    盘口，仅让球/让分/大小分用
 * @property {number} sp        出票赔率，必须出票时冻结
 */

/**
 * @typedef {object} Ticket
 * @property {string} id            稳定 id，写入时生成，重推不变
 * @property {'number' | 'parlay'} [kind] 缺省为 number（一期旧数据都走这条）
 * @property {GameId} game
 * @property {string} date          YYYY-MM-DD，购买日（本地时区）
 * @property {number[]} [red]       双色球红球 / 大乐透前区，升序去重
 * @property {number[]} [blue]      双色球蓝球 / 大乐透后区，升序去重
 * @property {Leg[]} [legs]         竞彩场次
 * @property {string} [passType]    过关方式，如 3x4；单关 1x1
 * @property {number} stake         数字彩为单注价，竞彩为整票面额
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
 * @property {number[]} [red]
 * @property {number[]} [blue]
 * @property {Record<string, object>} [results] 竞彩赛果，matchId → 比分/盘口
 * @property {'ok' | 'pending'} status
 * @property {string} [source]      来源 URL
 * @property {string} [fetchedAt]   ISO 抓取时间
 * @property {Record<number, number>} [prizeTable] 奖级 → 该期单注奖金（浮动奖用）
 * @property {number} [pool]        奖池余额，决定大乐透固定奖档位
 */

/**
 * 一注的判定结果。数字彩 level 为奖级，竞彩 level 仅表示中没中，注数看 bets。
 * @typedef {object} Verdict
 * @property {0 | 1} level
 * @property {number} amount        元，未中为 0
 * @property {number} [bets]        竞彩命中注数
 * @property {number} [redHit]
 * @property {number} [blueHit]
 * @property {{ matchId: string, market: string, selection: string, hit: string }[]} [legs]
 * @property {boolean} pending      开奖未落地
 * @property {string} [reason]      pending 或异常原因
 */

/** 大乐透奖池达到 8 亿后固定奖上浮，档位分界 */
export const DLT_POOL_HIGH = 800000000;

/** 旧数据没有 kind，有 legs 的就是竞彩 */
export const kindOf = (ticket) => ticket.kind ?? (ticket.legs ? 'parlay' : 'number');

/** 一注 2 元，追加 +1 元 */
export const UNIT_PRICE = 2;
export const ADD_PRICE = 1;
