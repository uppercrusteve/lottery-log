#!/usr/bin/env node
/**
 * 抓开奖，落 draws/YYYY-MM-DD.json。
 *
 * 只抓当天该开奖的彩种：双色球周二四日，大乐透周一三六。
 * 抓不到写 status: 'pending' 并记下错因，绝不把猜的号当开奖号。
 *
 * 用法：node scripts/fetch-draws.mjs [YYYY-MM-DD]
 * 环境变量 DATA_REPO（owner/name）与 GITHUB_TOKEN 存在时，抓完直接推。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const SSQ_DAYS = [0, 2, 4]; // 周日、周二、周四
const DLT_DAYS = [1, 3, 6]; // 周一、周三、周六

const argDate = process.argv[2];
const date = argDate ?? shanghaiDate();
const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

async function get(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...extraHeaders },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 双色球：福彩官方接口 */
async function fetchSsq() {
  const url =
    'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=5&pageNo=1&pageSize=5&systemType=PC';
  const json = JSON.parse(await get(url, { Referer: 'https://www.cwl.gov.cn/' }));
  const row = (json.result ?? []).find((r) => (r.date ?? '').slice(0, 10) === date);
  if (!row) throw new Error('官方未返回该日期的开奖');

  const prizeTable = {};
  for (const g of row.prizegrades ?? []) {
    const money = Number(g.typemoney);
    if (Number.isFinite(money) && money > 0) prizeTable[Number(g.type)] = money;
  }

  return {
    game: 'ssq',
    issue: String(row.code),
    date,
    red: splitNums(row.red),
    blue: splitNums(row.blue),
    status: 'ok',
    source: url,
    fetchedAt: new Date().toISOString(),
    prizeTable,
  };
}

/** 大乐透：体彩 getDigitalDrawInfoV1（V1V1 已废） */
async function fetchDlt() {
  const url = 'https://webapi.sporttery.cn/gateway/lottery/getDigitalDrawInfoV1.qry?param=85,0&isVerify=1';
  const json = JSON.parse(await get(url, { Referer: 'https://www.sporttery.cn/' }));
  const d = json?.value?.dlt?.lastPoolDraw;
  if (!d) throw new Error('官方未返回大乐透数据');
  const drawDate = (d.lotteryDrawTime ?? '').slice(0, 10);
  if (drawDate !== date) throw new Error(`拿到的是 ${drawDate} 的期次，不是 ${date}`);

  const all = splitNums(d.lotteryDrawResult);
  if (all.length !== 7) throw new Error(`开奖号位数不对：${d.lotteryDrawResult}`);

  const LEVEL_NAMES = { 一等奖: 1, 二等奖: 2, 三等奖: 3, 四等奖: 4, 五等奖: 5, 六等奖: 6, 七等奖: 7 };
  const prizeTable = {};
  for (const p of d.prizeLevelList ?? []) {
    // 该接口的 stakeAmountFormat 常是空串，金额在带逗号的 stakeAmount 里；
    // 带 "(追加)" 后缀的是追加档，不计入基本奖级
    const level = LEVEL_NAMES[p.prizeLevel];
    const money = Number(String(p.stakeAmountFormat || p.stakeAmount || '').replace(/,/g, ''));
    if (level && Number.isFinite(money) && money > 0) prizeTable[level] = money;
  }

  return {
    game: 'dlt',
    issue: String(d.lotteryDrawNum),
    date,
    red: all.slice(0, 5),
    blue: all.slice(5),
    status: 'ok',
    source: url,
    fetchedAt: new Date().toISOString(),
    prizeTable,
    pool: Number((d.poolBalanceAfterdraw ?? '').replace(/,/g, '')) || 0,
  };
}

const splitNums = (s) =>
  String(s ?? '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);

async function main() {
  const due = [];
  if (SSQ_DAYS.includes(weekday)) due.push(['ssq', fetchSsq]);
  if (DLT_DAYS.includes(weekday)) due.push(['dlt', fetchDlt]);

  if (!due.length) {
    console.log(`${date} 两种彩票都不开奖，跳过`);
    return;
  }

  const draws = [];
  for (const [game, fetcher] of due) {
    try {
      const d = await fetcher();
      draws.push(d);
      console.log(`✓ ${game} ${d.issue ?? ''} ${d.red.join(' ')} + ${d.blue.join(' ')}`);
    } catch (e) {
      draws.push({ game, date, status: 'pending', reason: e.message, fetchedAt: new Date().toISOString() });
      console.log(`✗ ${game}：${e.message}，记 pending`);
    }
  }

  const path = `${process.env.OUT_DIR ?? '.'}/draws/${date}.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schema: 1, kind: 'draws', date, items: draws }, null, 2)}\n`, 'utf8');
  console.log(`写入 ${path}`);
}

/** Asia/Shanghai 当天，避免 runner 是 UTC 时算错日子 */
function shanghaiDate() {
  const now = new Date(Date.now() + 8 * 3600_000);
  return now.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
