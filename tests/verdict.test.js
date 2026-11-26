import { describe, it, expect } from 'vitest';
import { evaluate, countHit, costOf, summarize } from '../core/verdict.js';
import * as ssq from '../core/rules/ssq.js';
import * as dlt from '../core/rules/dlt.js';

const ticket = (over = {}) => ({
  id: 't1',
  game: 'ssq',
  date: '2026-11-24',
  red: [1, 2, 3, 4, 5, 6],
  blue: [7],
  stake: 2,
  createdAt: '2026-11-24T10:00:00Z',
  ...over,
});

const draw = (over = {}) => ({
  game: 'ssq',
  issue: '2026135',
  date: '2026-11-24',
  red: [1, 2, 3, 4, 5, 6],
  blue: [7],
  status: 'ok',
  ...over,
});

describe('countHit', () => {
  it('只数交集', () => {
    expect(countHit([1, 2, 3], [3, 2, 9])).toBe(2);
    expect(countHit([], [1])).toBe(0);
    expect(countHit([1], [])).toBe(0);
  });
});

describe('双色球奖级', () => {
  // 票面 红 01-06 蓝 07；按需要构造开奖
  const cases = [
    { name: '一等奖 6+1', red: [1, 2, 3, 4, 5, 6], blue: 7, level: 1 },
    { name: '二等奖 6+0', red: [1, 2, 3, 4, 5, 6], blue: 8, level: 2 },
    { name: '三等奖 5+1', red: [2, 3, 4, 5, 6, 20], blue: 7, level: 3 },
    { name: '四等奖 5+0', red: [2, 3, 4, 5, 6, 20], blue: 8, level: 4 },
    { name: '四等奖 4+1', red: [3, 4, 5, 6, 20, 21], blue: 7, level: 4 },
    { name: '五等奖 4+0', red: [3, 4, 5, 6, 20, 21], blue: 8, level: 5 },
    { name: '五等奖 3+1', red: [4, 5, 6, 20, 21, 22], blue: 7, level: 5 },
    { name: '六等奖 2+1', red: [5, 6, 20, 21, 22, 23], blue: 7, level: 6 },
    { name: '六等奖 1+1', red: [6, 20, 21, 22, 23, 24], blue: 7, level: 6 },
    { name: '六等奖 0+1，蓝球单中就算', red: [20, 21, 22, 23, 24, 25], blue: 7, level: 6 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const v = evaluate(ticket(), draw({ red: c.red, blue: [c.blue] }));
      expect(v.level).toBe(c.level);
      expect(v.pending).toBe(false);
    });
  }

  it('2+0 没奖', () => {
    const v = evaluate(ticket(), draw({ red: [5, 6, 20, 21, 22, 23], blue: [8] }));
    expect(v.level).toBe(0);
    expect(v.amount).toBe(0);
  });

  it('固定奖直接给金额', () => {
    const v = evaluate(ticket(), draw({ red: [4, 5, 6, 20, 21, 22], blue: [7] }));
    expect(v.level).toBe(5);
    expect(v.amount).toBe(10);
  });

  it('一等奖缺当期金额时给 null，不猜', () => {
    const v = evaluate(ticket(), draw());
    expect(v.level).toBe(1);
    expect(v.amount).toBeNull();
    expect(v.reason).toMatch(/浮动奖/);
  });

  it('一等奖有当期金额时照用', () => {
    const v = evaluate(ticket(), draw({ prizeTable: { 1: 5000000 } }));
    expect(v.amount).toBe(5000000);
  });

  it('倍投乘金额', () => {
    const v = evaluate(ticket({ multiple: 3 }), draw({ red: [4, 5, 6, 20, 21, 22], blue: [7] }));
    expect(v.amount).toBe(30);
  });
});

describe('大乐透奖级', () => {
  const dt = (over = {}) =>
    ticket({ game: 'dlt', red: [1, 2, 3, 4, 5], blue: [6, 7], ...over });
  const dd = (red, blue, over = {}) => draw({ game: 'dlt', red, blue, pool: 0, ...over });

  const cases = [
    { name: '一等奖 5+2', red: [1, 2, 3, 4, 5], blue: [6, 7], level: 1 },
    { name: '二等奖 5+1', red: [1, 2, 3, 4, 5], blue: [6, 8], level: 2 },
    { name: '三等奖 5+0', red: [1, 2, 3, 4, 5], blue: [8, 9], level: 3 },
    { name: '三等奖 4+2', red: [2, 3, 4, 5, 30], blue: [6, 7], level: 3 },
    { name: '四等奖 4+1', red: [2, 3, 4, 5, 30], blue: [6, 8], level: 4 },
    { name: '五等奖 4+0', red: [2, 3, 4, 5, 30], blue: [8, 9], level: 5 },
    { name: '五等奖 3+2', red: [3, 4, 5, 30, 31], blue: [6, 7], level: 5 },
    { name: '六等奖 3+1', red: [3, 4, 5, 30, 31], blue: [6, 8], level: 6 },
    { name: '六等奖 2+2', red: [4, 5, 30, 31, 32], blue: [6, 7], level: 6 },
    { name: '七等奖 3+0', red: [3, 4, 5, 30, 31], blue: [8, 9], level: 7 },
    { name: '七等奖 2+1', red: [4, 5, 30, 31, 32], blue: [6, 8], level: 7 },
    { name: '七等奖 1+2', red: [5, 30, 31, 32, 33], blue: [6, 7], level: 7 },
    { name: '七等奖 0+2，后区全中也算', red: [30, 31, 32, 33, 34], blue: [6, 7], level: 7 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(evaluate(dt(), dd(c.red, c.blue)).level).toBe(c.level);
    });
  }

  it('2+0 没奖', () => {
    expect(evaluate(dt(), dd([4, 5, 30, 31, 32], [8, 9])).level).toBe(0);
  });

  it('奖池低于 8 亿走低档固定奖 5 元', () => {
    const v = evaluate(dt(), dd([30, 31, 32, 33, 34], [6, 7], { pool: 1000 }));
    expect(v.level).toBe(7);
    expect(v.amount).toBe(5);
  });

  it('奖池到 8 亿走高挡 7 元', () => {
    const v = evaluate(dt(), dd([30, 31, 32, 33, 34], [6, 7], { pool: 800000000 }));
    expect(v.level).toBe(7);
    expect(v.amount).toBe(7);
  });

  it('追加只加浮动奖：二等奖 100 万 → 180 万', () => {
    const v = evaluate(dt({ added: true }), dd([1, 2, 3, 4, 5], [6, 8], { prizeTable: { 2: 1000000 } }));
    expect(v.level).toBe(2);
    expect(v.amount).toBe(1800000);
  });

  it('追加不影响固定奖', () => {
    const v = evaluate(dt({ added: true }), dd([30, 31, 32, 33, 34], [6, 7]));
    expect(v.amount).toBe(5);
  });
});

describe('边界', () => {
  it('缺开奖记录 → pending', () => {
    const v = evaluate(ticket(), undefined);
    expect(v.pending).toBe(true);
    expect(v.reason).toMatch(/缺开奖/);
  });

  it('开奖 pending → pending', () => {
    const v = evaluate(ticket(), draw({ status: 'pending' }));
    expect(v.pending).toBe(true);
    expect(v.amount).toBe(0);
  });

  it('彩种不符 → pending 并说明', () => {
    const v = evaluate(ticket({ game: 'dlt' }), draw());
    expect(v.pending).toBe(true);
    expect(v.reason).toMatch(/彩种不符/);
  });

  it('mismatched 号码不会崩', () => {
    const v = evaluate(ticket({ red: [], blue: [] }), draw());
    expect(v.redHit).toBe(0);
    expect(v.blueHit).toBe(0);
  });
});

describe('成本与汇总', () => {
  it('追加按 3 元算', () => {
    expect(costOf(ticket({ game: 'dlt', added: true }))).toBe(3);
    expect(costOf(ticket())).toBe(2);
  });

  it('汇总只数已中与待开', () => {
    const s = summarize([
      { level: 6, amount: 5, pending: false },
      { level: 0, amount: 0, pending: false },
      { level: 0, amount: 0, pending: true },
    ]);
    expect(s).toEqual({ count: 3, won: 1, pending: 1, payout: 5 });
  });
});

describe('号码校验', () => {
  it('双色球合法', () => {
    expect(ssq.isValid({ red: [1, 2, 3, 4, 5, 6], blue: [7] })).toBe(true);
  });
  it('双色球红球重复不合法', () => {
    expect(ssq.isValid({ red: [1, 1, 3, 4, 5, 6], blue: [7] })).toBe(false);
  });
  it('双色球红球 34 不合法', () => {
    expect(ssq.isValid({ red: [1, 2, 3, 4, 5, 34], blue: [7] })).toBe(false);
  });
  it('大乐透合法', () => {
    expect(dlt.isValid({ red: [1, 2, 3, 4, 5], blue: [6, 7] })).toBe(true);
  });
  it('大乐透后区 13 不合法', () => {
    expect(dlt.isValid({ red: [1, 2, 3, 4, 5], blue: [6, 13] })).toBe(false);
  });
  it('大乐透后区只有 1 个不合法', () => {
    expect(dlt.isValid({ red: [1, 2, 3, 4, 5], blue: [6] })).toBe(false);
  });
});
