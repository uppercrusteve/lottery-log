import { describe, it, expect } from 'vitest';
import { settleLeg, needsLine } from '../core/rules/jc.js';
import { betCount, parlayAmount, comb, PASS_TYPES } from '../core/rules/pass.js';
import { evaluate, evaluateParlay } from '../core/verdict.js';
import { validateTicket, normalizeTicket, parseShard } from '../core/codec.js';

const final = (home, away, extra = {}) => ({ matchId: 'm1', status: 'final', home, away, ...extra });

const leg = (market, selection, extra = {}) => ({ matchId: 'm1', market, selection, sp: 2, ...extra });

describe('足球结算', () => {
  it('胜平负按全场比分', () => {
    expect(settleLeg(leg('spf', 'H'), final(2, 1))).toBe('hit');
    expect(settleLeg(leg('spf', 'D'), final(2, 1))).toBe('miss');
    expect(settleLeg(leg('spf', 'D'), final(1, 1))).toBe('hit');
    expect(settleLeg(leg('spf', 'A'), final(0, 3))).toBe('hit');
  });

  it('让球主队让一球，赢一球算让球平', () => {
    expect(settleLeg(leg('rqspf', 'D', { line: -1 }), final(2, 1))).toBe('hit');
    expect(settleLeg(leg('rqspf', 'H', { line: -1 }), final(2, 1))).toBe('miss');
    expect(settleLeg(leg('rqspf', 'A', { line: -2 }), final(2, 1))).toBe('hit');
  });

  it('让球主队受让，受让后反超', () => {
    expect(settleLeg(leg('rqspf', 'H', { line: 1 }), final(1, 1))).toBe('hit');
    expect(settleLeg(leg('rqspf', 'D', { line: 1 }), final(0, 1))).toBe('hit');
  });

  it('比分精确命中', () => {
    expect(settleLeg(leg('bf', '2:1'), final(2, 1))).toBe('hit');
    expect(settleLeg(leg('bf', '2:0'), final(2, 1))).toBe('miss');
  });

  it('比分落在枚举里就不算"其他"', () => {
    expect(settleLeg(leg('bf', 'oH'), final(2, 1))).toBe('miss');
    expect(settleLeg(leg('bf', 'oH'), final(6, 3))).toBe('hit');
    expect(settleLeg(leg('bf', 'oD'), final(4, 4))).toBe('hit');
    expect(settleLeg(leg('bf', 'oA'), final(0, 6))).toBe('hit');
    // 枚举里的平局仍是"其他平"以外
    expect(settleLeg(leg('bf', 'oD'), final(1, 1))).toBe('miss');
  });

  it('总进球逐档，七球以上归高档', () => {
    expect(settleLeg(leg('jqs', '3'), final(2, 1))).toBe('hit');
    expect(settleLeg(leg('jqs', '2'), final(2, 1))).toBe('miss');
    expect(settleLeg(leg('jqs', '7p'), final(4, 3))).toBe('hit');
    expect(settleLeg(leg('jqs', '7p'), final(3, 3))).toBe('miss');
  });

  it('半全场要半场和全场都对', () => {
    const r = final(2, 1, { halfHome: 2, halfAway: 0 });
    expect(settleLeg(leg('bqc', 'HH'), r)).toBe('hit');
    expect(settleLeg(leg('bqc', 'HA'), r)).toBe('miss');
    expect(settleLeg(leg('bqc', 'AA'), final(1, 2, { halfHome: 0, halfAway: 1 }))).toBe('hit');
  });

  it('半场比分缺失时算 pending，不当成没中', () => {
    expect(settleLeg(leg('bqc', 'HH'), final(2, 1))).toBe('pending');
  });
});

describe('篮球结算', () => {
  it('胜负按最终比分', () => {
    expect(settleLeg(leg('sf', 'H'), final(107, 105))).toBe('hit');
    expect(settleLeg(leg('sf', 'A'), final(107, 105))).toBe('miss');
  });

  it('让分是小数盘，加让分后比大小', () => {
    expect(settleLeg(leg('rf', 'H', { line: -1.5 }), final(107, 105))).toBe('hit');
    expect(settleLeg(leg('rf', 'H', { line: -2.5 }), final(107, 105))).toBe('miss');
    expect(settleLeg(leg('rf', 'A', { line: -2.5 }), final(107, 105))).toBe('hit');
  });

  it('大小分比总分', () => {
    expect(settleLeg(leg('dx', 'O', { line: 210 }), final(107, 105))).toBe('hit');
    expect(settleLeg(leg('dx', 'U', { line: 210 }), final(107, 105))).toBe('miss');
  });

  it('胜分差落在档内', () => {
    expect(settleLeg(leg('sfc', 'H1'), final(107, 105))).toBe('hit');
    expect(settleLeg(leg('sfc', 'H6'), final(107, 105))).toBe('miss');
    expect(settleLeg(leg('sfc', 'A26'), final(90, 130))).toBe('hit');
  });

  it('篮球不会走盘，打平视为数据可疑', () => {
    expect(settleLeg(leg('sf', 'H'), final(100, 100))).toBe('pending');
    expect(settleLeg(leg('dx', 'O', { line: 200 }), final(100, 100))).toBe('pending');
  });
});

describe('赛果缺失', () => {
  it('没赛果一律 pending', () => {
    expect(settleLeg(leg('spf', 'H'), undefined)).toBe('pending');
    expect(settleLeg(leg('spf', 'H'), { matchId: 'm1', status: 'pending' })).toBe('pending');
    expect(settleLeg(leg('spf', 'H'), { matchId: 'm1', status: 'final' })).toBe('pending');
  });

  it('不认识的玩法 pending', () => {
    expect(settleLeg(leg('xyz', 'H'), final(1, 0))).toBe('pending');
  });

  it('玩法需不需要盘口', () => {
    expect(needsLine('rqspf')).toBe(true);
    expect(needsLine('dx')).toBe(true);
    expect(needsLine('spf')).toBe(false);
  });
});

describe('过关注数', () => {
  it('组合数正确', () => {
    expect(comb(3, 2)).toBe(3);
    expect(comb(4, 2)).toBe(6);
    expect(comb(6, 4)).toBe(15);
    expect(comb(2, 3)).toBe(0);
  });

  it('过关方式注数与官方一致', () => {
    expect(betCount(2, '2x1')).toBe(1);
    expect(betCount(3, '3x3')).toBe(3);
    expect(betCount(3, '3x4')).toBe(4);
    expect(betCount(4, '4x11')).toBe(11);
    expect(betCount(5, '5x26')).toBe(26);
    expect(betCount(6, '6x57')).toBe(57);
    expect(betCount(8, '8x247')).toBe(247);
  });

  it('场次不够时注数为零', () => {
    expect(betCount(1, '2x1')).toBe(0);
  });

  it('所有过关方式的注数都能算出来', () => {
    for (const [pass, sizes] of Object.entries(PASS_TYPES)) {
      const n = Number(pass.split('x')[0]);
      expect(betCount(n, pass)).toBeGreaterThan(0);
      expect(sizes.every((m) => m <= n)).toBe(true);
    }
  });
});

describe('过关奖金', () => {
  const legs = [{ sp: 2 }, { sp: 3 }, { sp: 1.5 }];

  it('两串一全中按 SP 连乘', () => {
    expect(parlayAmount(legs.slice(0, 2), [true, true], '2x1').amount).toBe(12);
  });

  it('有一场没中就归零', () => {
    expect(parlayAmount(legs.slice(0, 2), [true, false], '2x1')).toEqual({ hits: 0, amount: 0 });
  });

  it('三串四算三注两串一加一注三串一', () => {
    const r = parlayAmount(legs, [true, true, true], '3x4');
    expect(r.hits).toBe(4);
    // 3 个两串一：2*2*3=12、2*2*1.5=6、2*3*1.5=9，加上三串一 2*2*3*1.5=18
    expect(r.amount).toBe(45);
  });

  it('倍投放大奖金', () => {
    expect(parlayAmount(legs.slice(0, 2), [true, true], '2x1', 3).amount).toBe(36);
  });

  it('单注封顶五百万', () => {
    const huge = [{ sp: 5000 }, { sp: 5000 }];
    expect(parlayAmount(huge, [true, true], '2x1').amount).toBe(5000000);
  });

  it('赔率缺失算零', () => {
    expect(parlayAmount([{ sp: 2 }, {}], [true, true], '2x1').amount).toBe(0);
  });
});

describe('整票判定', () => {
  const ticket = {
    id: 't1',
    kind: 'parlay',
    game: 'jcf',
    date: '2026-11-26',
    passType: '2x1',
    stake: 2,
    multiple: 1,
    legs: [
      { matchId: 'a', market: 'spf', selection: 'H', sp: 2 },
      { matchId: 'b', market: 'spf', selection: 'A', sp: 3 },
    ],
  };

  it('两场全中给奖金和注数', () => {
    const v = evaluateParlay(ticket, { a: final(2, 1), b: final(0, 1) });
    expect(v.pending).toBe(false);
    expect(v.bets).toBe(1);
    expect(v.level).toBe(1);
    expect(v.amount).toBe(12);
  });

  it('一场没中就是零注', () => {
    const v = evaluateParlay(ticket, { a: final(2, 1), b: final(1, 0) });
    expect(v.bets).toBe(0);
    expect(v.amount).toBe(0);
  });

  it('有一场没结算整票 pending，不先给部分金额', () => {
    const v = evaluateParlay(ticket, { a: final(2, 1) });
    expect(v.pending).toBe(true);
    expect(v.amount).toBe(0);
    expect(v.reason).toMatch(/未结算/);
  });

  it('每场都留下命中标记', () => {
    const v = evaluateParlay(ticket, { a: final(2, 1), b: final(0, 1) });
    expect(v.legs.map((l) => l.hit)).toEqual(['hit', 'hit']);
    expect(v.legs[0].matchId).toBe('a');
  });

  it('没有场次直接 pending', () => {
    expect(evaluateParlay({ ...ticket, legs: [] }, {}).pending).toBe(true);
  });

  it('evaluate 走 results 分支', () => {
    const v = evaluate(ticket, { status: 'ok', results: { a: final(2, 1), b: final(0, 1) } });
    expect(v.amount).toBe(12);
  });

  it('没有 legs 字段的旧票仍按数字彩判', () => {
    const old = { id: 'x', game: 'ssq', date: '2026-01-01', red: [1, 2, 3, 4, 5, 6], blue: [7], stake: 2 };
    expect(evaluate(old, { status: 'ok', game: 'ssq', red: [1, 2, 3, 4, 5, 6], blue: [7] }).level).toBe(1);
  });
});

describe('竞彩票校验', () => {
  const base = {
    id: 't1',
    kind: 'parlay',
    game: 'jcf',
    date: '2026-11-26',
    passType: '2x1',
    stake: 2,
    legs: [
      { matchId: 'a', market: 'spf', selection: 'H', sp: 2 },
      { matchId: 'b', market: 'spf', selection: 'A', sp: 3 },
    ],
  };

  it('正常票通过', () => {
    expect(validateTicket(base)).toEqual([]);
  });

  it('缺场次、重复场次、玩法串种都要报', () => {
    expect(validateTicket({ ...base, legs: [] })).toContain('竞彩票没有场次');
    const dup = { ...base, legs: [base.legs[0], { ...base.legs[1], matchId: 'a' }] };
    expect(validateTicket(dup).some((e) => e.includes('重复'))).toBe(true);
    const wrong = { ...base, legs: [{ matchId: 'a', market: 'sf', selection: 'H', sp: 2 }] };
    expect(validateTicket({ ...wrong, passType: '1x1' }).some((e) => e.includes('玩法不属于'))).toBe(true);
  });

  it('赔率必须大于一，盘口必须整数', () => {
    const bad = { ...base, passType: '1x1', legs: [{ matchId: 'a', market: 'rqspf', selection: 'H', sp: 1, line: -1.5 }] };
    const errs = validateTicket(bad);
    expect(errs.some((e) => e.includes('赔率非法'))).toBe(true);
    expect(errs.some((e) => e.includes('整数'))).toBe(true);
  });

  it('缺盘口的让球票要报', () => {
    const bad = { ...base, passType: '1x1', legs: [{ matchId: 'a', market: 'rqspf', selection: 'H', sp: 2 }] };
    expect(validateTicket(bad).some((e) => e.includes('缺盘口'))).toBe(true);
  });

  it('过关方式场次不够要报', () => {
    const bad = { ...base, legs: [base.legs[0]] };
    expect(validateTicket(bad).some((e) => e.includes('需要至少'))).toBe(true);
  });

  it('未知过关方式要报', () => {
    expect(validateTicket({ ...base, passType: '9x1' }).some((e) => e.includes('过关方式'))).toBe(true);
  });

  it('归一化保留场次并补 kind', () => {
    const n = normalizeTicket({ ...base, kind: undefined, legs: [{ ...base.legs[0], extra: 'x' }] });
    expect(n.kind).toBe('parlay');
    expect(n.legs[0].extra).toBeUndefined();
    expect(n.legs[0].matchId).toBe('a');
  });
});

describe('schema 迁移', () => {
  it('v1 分片读出来补上 kind', () => {
    const text = JSON.stringify({
      schema: 1,
      kind: 'tickets',
      date: '2026-01-01',
      items: [{ id: 'a', game: 'ssq', date: '2026-01-01', red: [1, 2, 3, 4, 5, 6], blue: [7], stake: 2 }],
    });
    const r = parseShard(text);
    expect(r.items[0].kind).toBe('number');
    expect(r.items[0].red).toHaveLength(6);
  });

  it('比程序新的 schema 拒绝解析', () => {
    const r = parseShard(JSON.stringify({ schema: 99, items: [] }));
    expect(r.error).toMatch(/比程序支持/);
  });
});
