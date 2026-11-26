#!/usr/bin/env node
/**
 * 抓竞彩赛程与赔率，落 matches/YYYY-MM-DD.json。
 *
 * 客户端直连官方接口会被 CORS 拦，所以赛程也走 Actions 落到数据仓，
 * App 只读数据仓。
 *
 * 赔率会浮动，这里抓的只是预填值，出票后必须以票面为准。
 *
 * 用法：node scripts/fetch-matches.mjs [YYYY-MM-DD]
 * 环境变量 OUT_DIR 可指定落盘根目录。
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

/** 官方玩法编码 → 本程序玩法 */
const POOLS = {
  football: { HAD: 'spf', HHAD: 'rqspf', CRS: 'bf', TTG: 'jqs', HAFU: 'bqc' },
  basketball: { MNL: 'sf', WNM: 'sfc', HDC: 'rf', HILO: 'dx' },
};

const argDate = process.argv[2];
const date = argDate ?? shanghaiDate();

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://www.sporttery.cn/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith('<')) throw new Error('返回了 HTML，接口参数可能变了');
  return JSON.parse(text);
}

/** 只保留当天与次日的在售场次 */
function pickDays(json, want) {
  const groups = json?.value?.matchInfoList ?? [];
  return groups.filter((g) => want.includes(g.businessDate)).flatMap((g) => g.subMatchList ?? []);
}

/**
 * 一场比赛蒸成稳定形状。三项式玩法带赔率，其余玩法的选项由客户端给。
 */
function tidy(kind, m) {
  const odds = {};
  for (const o of m.oddsList ?? []) {
    const market = POOLS[kind][o.poolCode];
    if (!market) continue;
    if (!o.h && !o.a) continue;
    odds[market] = {
      ...(o.h ? { h: Number(o.h) } : {}),
      ...(o.d ? { d: Number(o.d) } : {}),
      ...(o.a ? { a: Number(o.a) } : {}),
      ...(o.goalLine ? { line: Number(o.goalLine) } : {}),
    };
  }
  if (!Object.keys(odds).length) return null;

  return {
    matchId: String(m.matchId),
    matchNum: m.matchNumStr ?? String(m.matchNum ?? ''),
    league: m.leagueAbbName ?? m.leagueAllName ?? '',
    home: m.homeTeamAbbName ?? m.homeTeamAllName ?? '',
    away: m.awayTeamAbbName ?? m.awayTeamAllName ?? '',
    time: m.matchTime ?? '',
    status: m.matchStatus ?? '',
    odds,
  };
}

async function fetchKind(kind, want) {
  const json = await get(`https://webapi.sporttery.cn/gateway/uniform/${kind}/getMatchListV1.qry?clientCode=3001`);
  const items = pickDays(json, want)
    .filter((m) => m.matchStatus === 'Selling')
    .map((m) => tidy(kind, m))
    .filter(Boolean);
  return items;
}

async function main() {
  const want = [date, addDays(date, 1)];
  const out = { schema: 1, kind: 'matches', date, items: [] };

  for (const [kind, game] of [
    ['football', 'jcf'],
    ['basketball', 'jcb'],
  ]) {
    try {
      const items = await fetchKind(kind, want);
      out.items.push({ game, date, status: items.length ? 'ok' : 'pending', items });
      console.log(`${game}：${items.length} 场在售`);
    } catch (e) {
      out.items.push({ game, date, status: 'pending', reason: e.message });
      console.log(`✗ ${game}：${e.message}`);
    }
  }

  const path = `${process.env.OUT_DIR ?? '.'}/matches/${date}.json`;
  keepPrevious(out, path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`写入 ${path}`);
}

/**
 * 这次抓失败（pending）就沿用上次抓到的 ok 数据，别把好数据冲掉。
 * 只按 game 对齐，不合并场内条目：赛程是快照，以最近一次成功为准。
 */
function keepPrevious(out, path) {
  if (!existsSync(path)) return;
  let old;
  try {
    old = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return;
  }
  for (const item of out.items) {
    if (item.status === 'ok') continue;
    const prev = old.items?.find((o) => o.game === item.game && o.status === 'ok');
    if (!prev) continue;
    item.items = prev.items;
    item.status = 'ok';
    item.stale = true;
    item.reason = `本次抓取失败，沿用 ${old.date} 的上一份成功数据：${item.reason ?? '无在售场次'}`;
  }
}

const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

function shanghaiDate() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
