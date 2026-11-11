/* 日志页：分类筛选 + 自动滚动 + 警告/错误着色。
   初始 200 条走 /api/logs，之后靠 WS 的 log 事件增量追加。 */

import { h, icon, btn, chip, fmt, get, DASH } from '../ui.js';

const CATS = ['全部', '系统', '总线', '手柄', 'ToF', '视觉', 'AI', '训练'];
const MAX_LINES = 800;

let unsub = null;
let unsubEvent = null;
let ctxRef = null;
let el = {};
let lines = [];
let filter = '全部';
let pinned = true;
let loading = false;

export function page(ctx) {
  ctxRef = ctx;
  lines = [];
  filter = '全部';
  pinned = true;

  const filters = h('div.log-filters', { role: 'group', 'aria-label': '日志分类' });
  for (const c of CATS) {
    filters.append(h('button', {
      class: 'log-filter', type: 'button',
      'aria-pressed': String(c === filter),
      onclick: () => setFilter(c),
    }, c));
  }

  const view = h('div.log-view', { role: 'log', 'aria-live': 'off', tabindex: '0' });
  const countText = h('span.hint-line', {}, '');
  const autoBtn = h('button', {
    class: 'log-filter', type: 'button', 'aria-pressed': 'true',
    onclick: () => { pinned = !pinned; autoBtn.setAttribute('aria-pressed', String(pinned)); if (pinned) scrollBottom(); },
  }, '自动滚动');

  view.addEventListener('scroll', () => {
    pinned = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
    autoBtn.setAttribute('aria-pressed', String(pinned));
  });

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '日志'),
        h('div.page-desc', '系统 / 总线 / 手柄 / ToF / 视觉 / AI / 训练。警告黄、错误红，原文照抄。')),
      h('div.page-head-actions', {},
        countText,
        btn('刷新', { icon: 'refresh', onClick: () => load(true) }))),
    h('div.log-toolbar', {}, filters, h('div.spacer'), autoBtn,
      btn('清屏', { size: 'sm', kind: 'ghost', onClick: () => clearView() })),
    view);

  el = { view, filters, countText, autoBtn };
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paintMeta(ctx));
  unsubEvent = ctx.link.onEvent((name, data) => {
    if (name !== 'log') return;
    pushLine({
      t: new Date().toTimeString().slice(0, 8),
      ts: Date.now() / 1000,
      cat: data.cat || '系统',
      level: data.level || 'info',
      msg: data.msg || '',
      hint: data.hint || null,
    });
  });
  load(true);
}

export function unmount() {
  if (unsub) unsub();
  if (unsubEvent) unsubEvent();
  unsub = null;
  unsubEvent = null;
  ctxRef = null;
  el = {};
  lines = [];
}

function paintMeta(ctx) {
  if (!el.countText) return;
  el.countText.textContent = `${lines.length} 条`;
}

/* ---------------------------------------------------------------- 数据 */
async function load(reset) {
  const ctx = ctxRef;
  if (!ctx || loading) return;
  loading = true;
  try {
    const res = await fetch('/api/logs?n=300', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (reset) lines = [];
      render();
      toastInline(`读不到日志（HTTP ${res.status}）：${data.error || '会话可能过期'}`);
      return;
    }
    const items = (data.items || []).map((it) => ({
      ts: it.ts,
      t: it.t || fmt.clock(it.ts),
      cat: it.cat || '系统',
      level: it.level || 'info',
      msg: it.msg || '',
      hint: it.hint || null,
      n: it.n,
    }));
    lines = reset ? items : [...items, ...lines].slice(-MAX_LINES);
    render();
  } catch (err) {
    toastInline(`连不上设备：${err.message || err}`);
  } finally {
    loading = false;
  }
}

function toastInline(msg) {
  if (!el.view) return;
  el.view.replaceChildren(h('div.log-empty', {}, msg));
}

/* ---------------------------------------------------------------- 归一化 */
function normCat(cat) {
  const c = String(cat || '').toLowerCase();
  if (c.includes('servo') || c.includes('总线') || c.includes('bus')) return '总线';
  if (c.includes('pad') || c.includes('手柄')) return '手柄';
  if (c.includes('tof')) return 'ToF';
  if (c.includes('vision') || c.includes('视觉') || c.includes('camera')) return '视觉';
  if (c === 'ai' || c.startsWith('zeluxd.ai') || c.includes('语音')) return 'AI';
  if (c.includes('train') || c.includes('训练')) return '训练';
  return '系统';
}

function levelClass(level) {
  const l = String(level || '').toLowerCase();
  if (l.startsWith('crit')) return 'is-critical';
  if (l.startsWith('err')) return 'is-error';
  if (l.startsWith('warn')) return 'is-warning';
  return '';
}

/* ---------------------------------------------------------------- 渲染 */
function lineEl(it) {
  const cat = normCat(it.cat);
  const msg = h('span.msg', it.msg);
  if (it.hint) msg.append(h('div.hint', it.hint));
  return h('div', { class: `log-line ${levelClass(it.level)}`, dataset: { cat } },
    h('span.tm', it.t || DASH),
    h('span.cat', cat),
    msg);
}

function visible(it) {
  return filter === '全部' || normCat(it.cat) === filter;
}

function render() {
  if (!el.view) return;
  const shown = lines.filter(visible);
  if (!shown.length) {
    el.view.replaceChildren(h('div.log-empty', {},
      lines.length ? `「${filter}」下没有日志。` : '还没有日志。'));
    return;
  }
  el.view.replaceChildren(...shown.map(lineEl));
  if (pinned) scrollBottom();
  paintMeta(ctxRef);
}

function pushLine(it) {
  lines.push(it);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  if (!el.view) return;
  if (!visible(it)) { paintMeta(ctxRef); return; }
  // 增量化：只追加一条，避免每次重建 800 行
  const empty = el.view.querySelector('.log-empty');
  if (empty) el.view.replaceChildren();
  el.view.append(lineEl(it));
  while (el.view.childElementCount > MAX_LINES) el.view.firstElementChild.remove();
  if (pinned) scrollBottom();
  paintMeta(ctxRef);
}

function scrollBottom() {
  if (!el.view) return;
  el.view.scrollTop = el.view.scrollHeight;
}

function setFilter(c) {
  filter = c;
  for (const b of el.filters.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.textContent === c));
  }
  render();
}

function clearView() {
  lines = [];
  render();
}
