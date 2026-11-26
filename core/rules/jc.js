/**
 * 竞彩单场结算。
 *
 * 纯函数，只吃赛果，不碰网络。每个玩法一个函数，返回
 * 'hit' | 'miss' | 'pending'，不认识的一律 pending，宁可不算也不猜。
 *
 * 赛果对象（所有数字已由调用方解析好）：
 *   { matchId, status, home, away, halfHome, halfAway, line }
 *   status: 'final' 已结算 / 'pending' 未结算
 *   line:   让球数，足球为整数（可为 0），篮球为小数。结算一律用**票面**的
 *           leg.line，赛果里的盘口只是参考——出票时就冻结了。
 */

/** 足球玩法 */
export const FOOTBALL_MARKETS = ['spf', 'rqspf', 'bf', 'jqs', 'bqc'];
/** 篮球玩法 */
export const BASKET_MARKETS = ['sf', 'rf', 'dx', 'sfc'];

export const MARKET_NAMES = {
  spf: '胜平负',
  rqspf: '让球胜平负',
  bf: '比分',
  jqs: '总进球',
  bqc: '半全场',
  sf: '胜负',
  rf: '让分胜负',
  dx: '大小分',
  sfc: '胜分差',
};

/** 比分玩法的枚举档位，其余归"其他" */
const BF_GOALS = ['1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '5:2'];
const BF_DRAWS = ['0:0', '1:1', '2:2', '3:3'];
const BF_LOSES = ['0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '2:5'];
export const BF_OTHER = ['oH', 'oD', 'oA'];

/** 半全场 9 种 */
export const BQC_CODES = ['HH', 'HD', 'HA', 'DH', 'DD', 'DA', 'AH', 'AD', 'AA'];

/** 胜分差档位，少胜多 */
export const SFC_BANDS = [
  [1, 5, '1'],
  [6, 10, '6'],
  [11, 15, '11'],
  [16, 20, '16'],
  [21, 25, '21'],
  [26, Infinity, '26'],
];

const sign = (h, a) => (h > a ? 'H' : h === a ? 'D' : 'A');

/** 足球胜平负 */
function spf(home, away, sel) {
  const r = sign(home, away);
  // 竞彩胜平负允许标平，不标即错
  return sel === 'H' || sel === 'D' || sel === 'A' ? r === sel : false;
}

/** 让球胜平负：主队比分加让球数再比 */
function rqspf(home, away, line, sel) {
  if (!Number.isInteger(line)) return null; // 足球让球必为整数
  const r = sign(home + line, away);
  return sel === 'H' || sel === 'D' || sel === 'A' ? r === sel : false;
}

/** 比分：精确命中或落"其他"档 */
function bf(home, away, sel) {
  const score = `${home}:${away}`;
  if (sel === score) return true;
  if (!BF_OTHER.includes(sel)) return false;

  const s = sign(home, away);
  const known = s === 'H' ? BF_GOALS : s === 'D' ? BF_DRAWS : BF_LOSES;
  if (known.includes(score)) return false;
  return BF_OTHER[['H', 'D', 'A'].indexOf(s)] === sel;
}

/** 总进球：0–6 逐档，7 及以上归 '7p' */
function jqs(home, away, sel) {
  const total = home + away;
  if (sel === '7p') return total >= 7;
  if (!/^[0-6]$/.test(sel)) return false;
  return total === Number(sel);
}

/** 半全场：半场 + 全场两个符号拼接 */
function bqc(halfHome, halfAway, home, away, sel) {
  if (halfHome == null || halfAway == null) return null;
  const code = sign(halfHome, halfAway) + sign(home, away);
  return BQC_CODES.includes(sel) ? code === sel : false;
}

/** 篮球胜负，无平 */
function sf(home, away, sel) {
  if (home === away) return null; // 竞彩篮球不会平，出现即数据可疑
  return sel === sign(home, away);
}

/** 让分胜负：小数盘，加让分后比大小，不会走盘 */
function rf(home, away, line, sel) {
  if (!Number.isFinite(line)) return null;
  const adj = home + line;
  if (adj === away) return null; // 小数盘理论上不会平，真平了说明盘口记错
  return sel === (adj > away ? 'H' : 'A');
}

/** 大小分：总分对盘口，'O' 大 / 'U' 小 */
function dx(home, away, line, sel) {
  if (!Number.isFinite(line)) return null;
  const total = home + away;
  if (total === line) return null;
  return sel === (total > line ? 'O' : 'U');
}

/** 胜分差：绝对值落档，再看谁赢 */
function sfc(home, away, sel) {
  if (home === away) return null;
  const winner = home > away ? 'H' : 'A';
  const diff = Math.abs(home - away);
  const band = SFC_BANDS.find(([lo, hi]) => diff >= lo && diff <= hi);
  return band ? sel === winner + band[2] : false;
}

/**
 * 结算单场的一个选项。
 * @param {object} leg { market, selection, line }
 * @param {object | undefined} result 赛果
 * @returns {'hit' | 'miss' | 'pending'}
 */
export function settleLeg(leg, result) {
  if (!result || result.status !== 'final') return 'pending';
  if (result.home == null || result.away == null) return 'pending';

  const { market, selection } = leg;
  const ok = (v) => (v == null ? 'pending' : v ? 'hit' : 'miss');

  switch (market) {
    case 'spf':
      return ok(spf(result.home, result.away, selection));
    case 'rqspf':
      return ok(rqspf(result.home, result.away, leg.line, selection));
    case 'bf':
      return ok(bf(result.home, result.away, selection));
    case 'jqs':
      return ok(jqs(result.home, result.away, selection));
    case 'bqc':
      return ok(bqc(result.halfHome, result.halfAway, result.home, result.away, selection));
    case 'sf':
      return ok(sf(result.home, result.away, selection));
    case 'rf':
      return ok(rf(result.home, result.away, leg.line, selection));
    case 'dx':
      return ok(dx(result.home, result.away, leg.line, selection));
    case 'sfc':
      return ok(sfc(result.home, result.away, selection));
    default:
      return 'pending';
  }
}

/** 票面玩法属于哪个彩种 */
export function marketsOf(game) {
  return game === 'jcf' ? FOOTBALL_MARKETS : game === 'jcb' ? BASKET_MARKETS : [];
}

/** 该玩法是否需要盘口 */
export function needsLine(market) {
  return market === 'rqspf' || market === 'rf' || market === 'dx';
}
