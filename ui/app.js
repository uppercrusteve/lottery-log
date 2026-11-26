/**
 * UI 装配。只依赖 app/repository 和 adapters，不碰判定细节。
 *
 * 没配凭据时全走本地 IndexedDB，照样能记能看，联网后再配。
 */

import { repository, addDays } from '../app/repository.js';
import { idbStore, outbox } from '../adapters/store/idb.js';
import { memoryStore } from '../adapters/store/memory.js';
import { githubStore } from '../adapters/store/github.js';
import { creds } from '../adapters/creds.js';
import { GAMES } from '../core/models.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  game: 'ssq',
  red: [],
  blue: [],
  added: false,
  online: false,
  repo: null,
};

const local = idbStore();
const queue = outbox();
let repo = repository({ local, remote: memoryStore(), queue });

/** 远端可用就换成 GitHub，不可用保持纯本地 */
async function rebuild() {
  const [token, owner, repoName] = await Promise.all([creds.token(), creds.owner(), creds.repo()]);
  if (!token || !owner || !repoName) {
    state.online = false;
    repo = repository({ local, remote: memoryStore(), queue });
    return false;
  }
  state.online = true;
  repo = repository({ local, remote: githubStore({ owner, repo: repoName, getToken: () => creds.token() }), queue });
  return true;
}

const today = () => {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
};

const pad2 = (n) => String(n).padStart(2, '0');

/** 按当前彩种渲染号码盘 */
function renderGrids() {
  const g = GAMES[state.game];
  const isDlt = state.game === 'dlt';
  const redMax = isDlt ? g.frontMax : g.redMax;
  const blueMax = isDlt ? g.backMax : g.blueMax;
  const redNeed = isDlt ? g.frontCount : g.redCount;
  const blueNeed = isDlt ? g.backCount : g.blueCount;

  $('#red-label').innerHTML = `${isDlt ? '前区' : '红球'} <em>选 ${redNeed}</em>`;
  $('#blue-label').innerHTML = `${isDlt ? '后区' : '蓝球'} <em>选 ${blueNeed}</em>`;
  $('#red-count').textContent = `${state.red.length} / ${redNeed}`;
  $('#blue-count').textContent = `${state.blue.length} / ${blueNeed}`;

  fill($('#red-grid'), 'red', redMax);
  fill($('#blue-grid'), 'blue', blueMax);
  document.querySelectorAll('.only-dlt').forEach((el) => (el.hidden = !isDlt));
}

function fill(host, kind, max) {
  host.textContent = '';
  for (let n = 1; n <= max; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ball';
    b.dataset.kind = kind;
    b.dataset.n = String(n);
    b.textContent = pad2(n);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => toggle(kind, n));
    host.append(b);
  }
}

function toggle(kind, n) {
  const g = GAMES[state.game];
  const isDlt = state.game === 'dlt';
  const need = kind === 'red' ? (isDlt ? g.frontCount : g.redCount) : isDlt ? g.backCount : g.blueCount;
  const arr = kind === 'red' ? state.red : state.blue;

  const at = arr.indexOf(n);
  if (at >= 0) arr.splice(at, 1);
  else if (arr.length < need) arr.push(n);
  else {
    hint(`${kind === 'red' ? '红球' : '蓝球'}最多 ${need} 个，先取消一个`, 'err');
    return;
  }

  arr.sort((a, b) => a - b);
  syncGrid(kind);
}

function syncGrid(kind) {
  const arr = kind === 'red' ? state.red : state.blue;
  const set = new Set(arr);
  document.querySelectorAll(`.ball[data-kind="${kind}"]`).forEach((b) => {
    const on = set.has(Number(b.dataset.n));
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const g = GAMES[state.game];
  const isDlt = state.game === 'dlt';
  $(kind === 'red' ? '#red-count' : '#blue-count').textContent =
    `${arr.length} / ${kind === 'red' ? (isDlt ? g.frontCount : g.redCount) : isDlt ? g.backCount : g.blueCount}`;
}

const hint = (msg, cls = '') => {
  const el = $('#entry-hint');
  el.textContent = msg;
  el.className = `hint ${cls}`;
};

async function save() {
  const g = GAMES[state.game];
  const isDlt = state.game === 'dlt';
  const needRed = isDlt ? g.frontCount : g.redCount;
  const needBlue = isDlt ? g.backCount : g.blueCount;

  if (state.red.length !== needRed) return hint(`还要选 ${needRed - state.red.length} 个${isDlt ? '前区' : '红球'}`, 'err');
  if (state.blue.length !== needBlue) return hint(`还要选 ${needBlue - state.blue.length} 个${isDlt ? '后区' : '蓝球'}`, 'err');

  const stake = Number($('#in-stake').value);
  if (!(stake > 0)) return hint('金额要大于 0', 'err');

  const ticket = {
    id: crypto.randomUUID(),
    game: state.game,
    date: $('#in-date').value || today(),
    red: [...state.red],
    blue: [...state.blue],
    stake,
    multiple: Math.max(1, Number($('#in-multiple').value) || 1),
    ...(isDlt && state.added ? { added: true } : {}),
    createdAt: new Date().toISOString(),
  };

  try {
    // 没连数据仓就别走远端，否则会误报“已推到仓库”
    const r = await repo.addTicket(ticket, { offline: !state.online });
    if (!state.online) hint('记在本机了。接上数据仓后可同步', 'ok');
    else hint(r.pushed ? '记下了，已推到数据仓' : `记在本机了（${r.reason}）`, r.pushed ? 'ok' : 'err');
    state.red = [];
    state.blue = [];
    syncGrid('red');
    syncGrid('blue');
    await refresh();
  } catch (e) {
    hint(e.message, 'err');
  }
}

function randomPick() {
  const g = GAMES[state.game];
  const isDlt = state.game === 'dlt';
  const pick = (max, n) => {
    const pool = Array.from({ length: max }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).sort((a, b) => a - b);
  };
  state.red = pick(isDlt ? g.frontMax : g.redMax, isDlt ? g.frontCount : g.redCount);
  state.blue = pick(isDlt ? g.backMax : g.blueMax, isDlt ? g.backCount : g.blueCount);
  syncGrid('red');
  syncGrid('blue');
}

const LEVEL_NAME = { 1: '一等奖', 2: '二等奖', 3: '三等奖', 4: '四等奖', 5: '五等奖', 6: '六等奖', 7: '七等奖' };

function entryEl(row) {
  const { ticket: t, verdict: v, cost } = row;
  const el = document.createElement('article');
  el.className = `entry${v.level > 0 ? ' hit' : ''}`;

  const top = document.createElement('div');
  top.className = 'entry-top';
  const meta = document.createElement('span');
  meta.className = 'entry-date';
  meta.textContent = `${GAMES[t.game]?.name ?? t.game} · ${t.date}${t.multiple > 1 ? ` · ${t.multiple} 倍` : ''}${t.added ? ' · 追加' : ''}`;
  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '删除';
  del.addEventListener('click', async () => {
    await repo.removeTicket(t.id, t.date);
    await refresh();
  });
  top.append(meta, del);

  const nums = document.createElement('div');
  nums.className = 'nums';
  const draw = v.pending ? null : true;
  for (const n of t.red) nums.append(ball(n, 'r', v.pending ? false : hitRed(v, n, t)));
  const sep = document.createElement('span');
  sep.className = 'muted';
  sep.textContent = '+';
  nums.append(sep);
  for (const n of t.blue) nums.append(ball(n, 'b', false));

  const verdict = document.createElement('div');
  if (v.pending) {
    verdict.className = 'verdict pend';
    verdict.textContent = `待开奖（${v.reason}）`;
  } else if (v.level === 0) {
    verdict.className = 'verdict miss';
    verdict.textContent = `未中 · 红${v.redHit} 蓝${v.blueHit}`;
  } else {
    verdict.className = 'verdict hit';
    verdict.textContent = `${LEVEL_NAME[v.level]}${v.amount == null ? ' · 金额待官方公布' : ` · ${v.amount} 元`}`;
  }

  const foot = document.createElement('div');
  foot.className = 'entry-foot';
  const spent = document.createElement('span');
  spent.textContent = `花 ${cost} 元`;
  const net = document.createElement('span');
  net.textContent = v.amount ? `收 ${v.amount} 元` : '';
  foot.append(spent, net);

  el.append(top, nums, verdict, foot);
  void draw;
  return el;
}

// 票面球用固定顺序显示，中没中用边框和底色区分
function ball(n, kind, on) {
  const s = document.createElement('span');
  s.className = `n ${kind}${on ? ' on' : ''}`;
  s.textContent = pad2(n);
  return s;
}

// 判定结果里没有逐号命中信息，这里按开奖号重算一次用于染色
const drawCache = new Map();
function hitRed(v, _n, _t) {
  return v.redHit > 0 && drawCache.get(v)?.has(_n) === true;
}

async function refresh() {
  let rows = [];
  try {
    rows = await repo.timeline();
  } catch (e) {
    hint(`读记录失败：${e.message}`, 'err');
  }

  // 逐条取开奖号，给命中球染色
  for (const r of rows) {
    if (r.verdict.pending) continue;
    for (const date of [r.ticket.date, addDays(r.ticket.date, 1)]) {
      const draws = await repo.loadDraw(date);
      const d = draws.find((x) => x.game === r.ticket.game && x.status === 'ok');
      if (d) {
        drawCache.set(r.verdict, new Set([...d.red, ...d.blue]));
        break;
      }
    }
  }

  const list = $('#timeline');
  list.textContent = '';
  rows.forEach((r) => list.append(entryEl(r)));
  $('#empty').hidden = rows.length > 0;

  try {
    const s = await repo.stats();
    $('#st-net').textContent = `${s.net >= 0 ? '+' : ''}${s.net}`;
    $('#st-net').parentElement.className = `stat ${s.net >= 0 ? 'win' : 'lose'}`;
    $('#st-won').textContent = String(s.won);
    $('#st-spent').textContent = String(s.spent);
    $('#st-pending').textContent = String(s.pending);
  } catch {
    /* 统计失败不挡住列表 */
  }
}

/** 当天或次日的开奖号，用于染色 */

/* 事件 */
document.querySelectorAll('.seg').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach((x) => {
      x.classList.toggle('is-on', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    state.game = b.dataset.game;
    state.red = [];
    state.blue = [];
    renderGrids();
    hint('');
  }),
);

$('#btn-added').addEventListener('click', (e) => {
  state.added = !state.added;
  e.currentTarget.setAttribute('aria-pressed', String(state.added));
  e.currentTarget.textContent = state.added ? '开' : '关';
});

$('#btn-random').addEventListener('click', randomPick);
$('#btn-save').addEventListener('click', save);

$('#btn-repeat').addEventListener('click', async () => {
  try {
    const rows = await repo.timeline();
    const last = rows.find((r) => r.ticket.game === state.game);
    if (!last) return hint('还没有同一彩种的记录', 'err');
    state.red = [...last.ticket.red];
    state.blue = [...last.ticket.blue];
    syncGrid('red');
    syncGrid('blue');
    hint('照上次的号填好了，确认后再记');
  } catch (e) {
    hint(e.message, 'err');
  }
});

const sheet = $('#settings');
const scrim = $('#scrim');
const openSheet = async (open) => {
  sheet.hidden = !open;
  scrim.hidden = !open;
  if (open) {
    $('#in-owner').value = (await creds.owner()) ?? '';
    $('#in-repo').value = (await creds.repo()) ?? '';
    $('#in-token').value = '';
    $('#settings-hint').textContent = '';
  }
};
$('#btn-settings').addEventListener('click', () => openSheet(true));
scrim.addEventListener('click', () => openSheet(false));

$('#btn-connect').addEventListener('click', async () => {
  const owner = $('#in-owner').value.trim();
  const repoName = $('#in-repo').value.trim();
  const token = $('#in-token').value.trim();
  const note = $('#settings-hint');

  if (!owner || !repoName || !token) {
    note.textContent = '三项都要填';
    note.className = 'hint err';
    return;
  }

  await creds.save({ token, owner, repo: repoName });
  note.textContent = '校验中…';
  note.className = 'hint';

  try {
    const ok = await rebuild();
    // 真读写一次，确认权限够
    await repo.push(today(), {});
    note.textContent = ok ? '连上了' : '没连上';
    note.className = ok ? 'hint ok' : 'hint err';
    await refresh();
  } catch (e) {
    note.textContent = `校验失败：${e.message}`;
    note.className = 'hint err';
  }
});

$('#btn-clear').addEventListener('click', async () => {
  await creds.clear();
  await rebuild();
  const note = $('#settings-hint');
  note.textContent = '凭据已清除，之后只存本机';
  note.className = 'hint';
});

/* 启动 */
$('#in-date').value = today();
renderGrids();
await rebuild();
await refresh();

// 次日开奖还没落地时顺手补一下提示
