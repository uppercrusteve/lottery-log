import { describe, it, expect } from 'vitest';
import { repository, addDays } from '../app/repository.js';
import { memoryStore } from '../adapters/store/memory.js';
import * as codec from '../core/codec.js';

const tick = (over = {}) => ({
  id: 'a',
  game: 'ssq',
  date: '2026-11-24',
  red: [1, 2, 3, 4, 5, 6],
  blue: [7],
  stake: 2,
  createdAt: '2026-11-24T10:00:00.000Z',
  ...over,
});

const setup = () => {
  const local = memoryStore();
  const remote = memoryStore();
  return { local, remote, repo: repository({ local, remote }) };
};

describe('addDays', () => {
  it('跨月进位', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('记票', () => {
  it('落到本地也推到远程', async () => {
    const { local, remote, repo } = setup();
    const r = await repo.addTicket(tick());
    expect(r.pushed).toBe(true);
    expect((await remote.readTicketShard('2026-11-24'))).toContain('"id": "a"');
    expect((await local.readTicketShard('2026-11-24'))).toContain('"id": "a"');
  });

  it('号码不合法直接抛', async () => {
    const { repo } = setup();
    await expect(repo.addTicket(tick({ red: [1, 2, 3] }))).rejects.toThrow(/号码不合法/);
  });

  it('金额为 0 直接抛', async () => {
    const { repo } = setup();
    await expect(repo.addTicket(tick({ stake: 0 }))).rejects.toThrow(/金额非法/);
  });

  it('远程已有的同 id 被本地覆盖，不同 id 并存', async () => {
    const { local, remote, repo } = setup();
    await remote.writeTicketShard(
      '2026-11-24',
      codec.writeTickets('2026-11-24', [tick({ id: 'a', stake: 99 }), tick({ id: 'b' })]),
    );
    await local.writeTicketShard('2026-11-24', codec.writeTickets('2026-11-24', [tick({ id: 'a', stake: 2 })]));

    await repo.push('2026-11-24', {});

    const items = codec.parseShard(await remote.readTicketShard('2026-11-24')).items;
    expect(items.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(items.find((t) => t.id === 'a').stake).toBe(2);
  });

  it('离线时进队列不算成功', async () => {
    const local = memoryStore();
    const added = [];
    const repo = repository({ local, remote: memoryStore(), queue: { add: async (p) => added.push(p), remove: async () => {} } });
    const r = await repo.addTicket(tick(), { offline: true });
    expect(r.pushed).toBe(false);
    expect(added).toContain('tickets/2026-11-24.json');
  });

  it('删除按 id 生效', async () => {
    const { repo, remote } = setup();
    await repo.addTicket(tick());
    await repo.removeTicket('a', '2026-11-24');
    const items = codec.parseShard(await remote.readTicketShard('2026-11-24')).items;
    expect(items).toHaveLength(0);
  });
});

describe('读取合并', () => {
  it('远端多出来的票会并进时间线', async () => {
    const { remote, repo } = setup();
    await repo.addTicket(tick({ id: 'a' }));
    // 另一台设备推到远端的票，本地没有
    await remote.writeTicketShard(
      '2026-11-24',
      codec.writeTickets('2026-11-24', [tick({ id: 'b' })], []),
    );
    const rows = await repo.timeline();
    expect(rows.map((r) => r.ticket.id).sort()).toEqual(['a', 'b']);
  });

  it('远端删过的票不会被本地复活', async () => {
    const { remote, repo } = setup();
    await repo.addTicket(tick({ id: 'a' }));
    await remote.writeTicketShard('2026-11-24', codec.writeTickets('2026-11-24', [], ['a']));
    expect(await repo.timeline()).toHaveLength(0);
  });

  it('远端读失败时退回本地，不抛', async () => {
    const { remote, repo } = setup();
    await repo.addTicket(tick({ id: 'a' }));
    remote.readTicketShard = async () => {
      throw new Error('网络断了');
    };
    const rows = await repo.timeline();
    expect(rows).toHaveLength(1);
  });
});

describe('时间线', () => {
  it('没开奖时标 pending', async () => {
    const { repo } = setup();
    await repo.addTicket(tick());
    const rows = await repo.timeline();
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict.pending).toBe(true);
  });

  it('次日开奖也能对上并判中', async () => {
    const { remote, repo } = setup();
    await repo.addTicket(tick({ date: '2026-11-24' }));
    await remote.writeDrawShard(
      '2026-11-25',
      codec.writeDraws('2026-11-25', [
        { game: 'ssq', issue: '1', date: '2026-11-25', red: [1, 2, 3, 4, 5, 6], blue: [7], status: 'ok' },
      ]),
    );
    const rows = await repo.timeline();
    expect(rows[0].verdict.level).toBe(1);
    expect(rows[0].verdict.pending).toBe(false);
  });

  it('统计给出投入与净额', async () => {
    const { remote, repo } = setup();
    await repo.addTicket(tick({ date: '2026-11-24' }));
    await remote.writeDrawShard(
      '2026-11-24',
      codec.writeDraws('2026-11-24', [
        { game: 'ssq', issue: '1', date: '2026-11-24', red: [1, 2, 3, 4, 5, 6], blue: [8], status: 'ok', prizeTable: { 2: 100000 } },
      ]),
    );
    const s = await repo.stats();
    expect(s.spent).toBe(2);
    expect(s.payout).toBe(100000);
    expect(s.net).toBe(99998);
  });
});
