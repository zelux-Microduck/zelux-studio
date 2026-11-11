/* ToF 页：8×8 热力网格 + 三扇区决策 + 避障参数。
   避障只做减速/绕行/停车，永远不会解除急停——这行字在页面上也要写清楚。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, switchEl, throttle, debounce, toast,
} from '../ui.js';

const ACTION_CN = { clear: '直行', slow: '减速', turn: '绕行', stop: '停车' };
const ACTION_SAY = {
  clear: '前方通畅',
  slow: '前面有点近，降速',
  turn: '前面堵着，往空的一侧绕',
  stop: '太近了，先停下',
};

let unsub = null;
let ctxRef = null;
let el = {};
let cells = [];
let lastSig = '';

const BANDS = [
  { max: 250, color: '#FF5A5F', label: '< 250' },
  { max: 600, color: '#FF8A45', label: '250–600' },
  { max: 1200, color: '#FFB020', label: '600–1200' },
  { max: 2000, color: '#3ED3A8', label: '1.2–2 m' },
  { max: Infinity, color: '#9FE8D3', label: '> 2 m' },
];

function bandColor(mm) {
  if (mm === null || mm === undefined || !Number.isFinite(Number(mm))) return null;
  const v = Number(mm);
  for (const b of BANDS) if (v < b.max) return b.color;
  return BANDS[BANDS.length - 1].color;
}

export function page(ctx) {
  ctxRef = ctx;
  lastSig = '';
  cells = [];

  const grid = h('div.tof-grid', { role: 'img', 'aria-label': '8×8 距离热力图' });
  for (let i = 0; i < 64; i += 1) {
    const c = h('div.tof-cell', {}, h('span.v', ''));
    cells.push(c);
    grid.append(c);
  }

  const legend = h('div.tof-legend', {},
    h('span', {}, '距离'),
    h('div.scale', {}, ...BANDS.map((b) => h('i', { style: { background: b.color }, title: b.label }))),
    h('span.mono', {}, 'mm'),
    h('div.ticks', {}, ...['0', '600', '1200', '2000', '3000'].map((t) => h('span', {}, t))));

  const gridCard = card({ title: '8×8 分区', sub: '越红越近；斜纹格是无效读数' }, grid, legend);

  /* ---------------- 概览 ---------------- */
  const nearest = h('div.big-num', { class: 'live-num' }, DASH);
  const validText = h('div.hint-line', {}, '');
  const hzText = h('span.kv-v.mono', {}, DASH);
  const stateText = h('span.kv-v', {}, DASH);
  const sensorText = h('span.kv-v.mono', {}, DASH);
  const nearestCard = card({ title: '最近距离' },
    h('div.row-between', {},
      h('div', {}, nearest, validText),
      h('div', { style: { textAlign: 'right' } }, stateText)),
    h('div', { style: { marginTop: '10px' } },
      h('div.kv', {}, h('span.kv-k', '刷新率'), hzText),
      h('div.kv', {}, h('span.kv-k', '芯片'), sensorText)));

  /* ---------------- 决策 ---------------- */
  const decideDot = h('i.dot');
  const decideTxt = h('div.txt', {}, '—');
  const decideSub = h('div.sub', {}, '');
  const decide = h('div.decide', {}, decideDot, h('div.grow', {}, decideTxt, decideSub));
  const sectorBox = h('div.sector-bars', {});

  const avoidSwitch = switchEl(false, (on) => setAvoid(on), { label: '自动避障' });
  const reasonText = h('div.hint-line', {}, '');

  const decisionCard = card({ title: '避障决策' },
    h('div.row-between', {},
      h('div', {}, h('div.t', { style: { fontSize: '12.8px', fontWeight: '550' } }, '自动避障'),
        h('div.d', { style: { fontSize: '11.5px', color: 'var(--ink-3)' } }, '只看中扇区最近的一档')),
      avoidSwitch),
    h('div', { style: { marginTop: '10px' } }, decide),
    h('div', { style: { marginTop: '10px' } }, sectorBox),
    reasonText,
    h('div.note', { style: { marginTop: '10px' } }, icon('alert', 15),
      h('div', {}, '避障只会减速/绕行/停车，不会解除急停。急停后避障只报状态、不下发速度。')));

  /* ---------------- 参数 ---------------- */
  const stopInput = paramInput('停车阈值', 60, 1200, 220, 'mm', (v) => sendCfg({ stop_mm: v }));
  const slowInput = paramInput('减速阈值', 120, 3000, 600, 'mm', (v) => sendCfg({ slow_mm: v }));
  const sideInput = paramInput('绕行侧宽', 200, 4000, 900, 'mm', (v) => sendCfg({ side_mm: v }));
  const paramCard = card({ title: '三档参数', sub: '拖动后约 0.4 s 生效' },
    h('div.stack', {}, stopInput.el, slowInput.el, sideInput.el),
    h('div.hint-line', { style: { marginTop: '8px' } },
      '中扇区 < 停车阈值 → 停；< 减速阈值 → 降到 40%；此时一侧明显更宽（> 侧宽）→ 往那边绕。'));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', 'ToF 避障'),
        h('div.page-desc', '8×8 直方图 + 三扇区判据。中间只留 2 列，避免左右墙把鸭子拉进误刹。')),
      h('div.page-head-actions', {},
        btn('去训练', { onClick: () => ctx.go('/train') }))),
    h('div.tof-layout', {},
      h('div.stack', {}, gridCard, paramCard),
      h('div.stack', {}, nearestCard, decisionCard)));

  el = {
    grid, nearest, validText, hzText, stateText, sensorText, decide, decideTxt, decideSub, decideDot,
    sectorBox, avoidSwitch, reasonText, stopInput, slowInput, sideInput,
  };
  // 订阅状态总线：没有这一句，页面永远是"没有数据"（paint 定义了却没人调）。
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
  return pageEl;
}

export function mount(ctx) {
  paint(ctx);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
}

function paramInput(label, min, max, value, unit, onChange) {
  const out = h('span.mono', { style: { minWidth: '58px', textAlign: 'right' } }, `${value} ${unit}`);
  const range = h('input', {
    type: 'range', min: String(min), max: String(max), step: '10', value: String(value),
    style: { width: '100%' },
    'aria-label': label,
  });
  const fire = debounce((v) => onChange(v), 400);
  range.addEventListener('input', () => {
    out.textContent = `${range.value} ${unit}`;
    fire(Number(range.value));
  });
  const row = h('div', {},
    h('div.row-between', {}, h('span.field-label', label), out),
    range);
  return { el: row, range, out, set(v) {
    if (document.activeElement === range) return;
    if (v === null || v === undefined) return;
    range.value = String(Math.round(v));
    out.textContent = `${Math.round(v)} ${unit}`;
  } };
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const tof = st.tof || {};
  const avoid = tof.avoid || {};
  const ready = tof.state === 'ready';

  // 网格
  const dist = Array.isArray(tof.distance_mm) ? tof.distance_mm : [];
  const status = Array.isArray(tof.status) ? tof.status : [];
  const sig = dist.length ? `${dist.join(',')}|${status.join(',')}` : 'none';
  if (sig !== lastSig) {
    lastSig = sig;
    for (let i = 0; i < 64; i += 1) {
      const cell = cells[i];
      const d = dist[i];
      const s = status[i];
      const valid = status.length ? (s === 5 || s === 9) && d > 0 : Number.isFinite(d);
      const color = valid ? bandColor(d) : null;
      cell.className = `tof-cell${valid ? '' : ' invalid'}`;
      cell.style.background = color || '';
      const txt = cell.firstChild;
      if (txt) txt.textContent = valid && d ? String(Math.round(d)) : '';
      cell.title = valid ? `${i} 格 · ${fmt.mm(d)}` : `${i} 格 · 无效`;
      cell.style.color = color && d < 600 ? '#3A0B0D' : 'rgba(11,15,20,.55)';
    }
  }

  // 概览
  const near = tof.nearest_mm;
  el.nearest.replaceChildren(
    h('span.live-num', near == null ? DASH : fmt.int(near)),
    h('span.unit', 'mm'));
  el.validText.textContent = tof.valid_count == null
    ? (tof.zones_omitted ? '明细被降频了（不在 ToF 页）' : '没有有效读数')
    : `${tof.valid_count}/64 格有效`;
  el.hzText.textContent = tof.hz == null ? DASH : `${fmt.f1(tof.hz)} Hz`;
  const stateCN = { ready: '就绪', waiting: '等第一帧', unavailable: '不可用', error: '出错', stale: '数据过期' }[tof.state] || '未知';
  el.stateText.textContent = stateCN;
  el.stateText.style.color = ready ? 'var(--brand-ink)' : 'var(--warn-ink)';
  el.sensorText.textContent = tof.sensor || DASH;

  // 决策
  const action = avoid.action || 'clear';
  const on = Boolean(avoid.on);
  el.decide.dataset.action = action;
  const c = avoid.sector?.c;
  el.decideTxt.textContent = on
    ? `${ACTION_CN[action] || action}：${ACTION_SAY[action] || ''}`
    : '避障没开：只显示数据，不接管速度';
  const bits = [];
  if (on) {
    if (c != null) bits.push(`中 ${fmt.int(c)} mm`);
    if (avoid.pending) bits.push(`防抖中 → ${ACTION_CN[avoid.pending] || avoid.pending}`);
    if (avoid.blocked) bits.push(`被挡住：${avoid.blocked}`);
    if (avoid.frames != null) bits.push(`连续 ${avoid.frames} 帧`);
    bits.push(`vx ${fmt.f2(avoid.vx)} / wz ${fmt.f2(avoid.wz)}`);
  }
  el.decideSub.textContent = bits.join(' · ');
  el.reasonText.textContent = avoid.reason || (on ? '' : '打开开关后才会下发速度。');

  el.avoidSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  el.avoidSwitch.disabled = !ctx.link.online;

  // 扇区条
  const sec = avoid.sector || {};
  const scale = Math.max(1200, Number(get(avoid, 'config.slow_mm', 600)) * 2, Number(sec.l || 0), Number(sec.c || 0), Number(sec.r || 0));
  el.sectorBox.replaceChildren(...[['l', '左'], ['c', '中'], ['r', '右']].map(([k, label]) => {
    const v = sec[k];
    const pct = v == null ? 0 : Math.max(2, Math.min(100, (v / scale) * 100));
    const color = v == null ? 'var(--line-2)' : v < Number(get(avoid, 'config.stop_mm', 220)) ? 'var(--danger)'
      : v < Number(get(avoid, 'config.slow_mm', 600)) ? 'var(--warn)' : 'var(--brand)';
    return h('div.sector-bar', {},
      h('span.lb', label),
      h('div.bar', {}, h('i', { style: { width: `${pct}%`, background: color } })),
      h('span.mm', v == null ? DASH : `${fmt.int(v)} mm`));
  }));

  // 参数
  const conf = avoid.config || {};
  el.stopInput.set(conf.stop_mm);
  el.slowInput.set(conf.slow_mm);
  el.sideInput.set(conf.side_mm);

  // 无障碍摘要
  el.grid.setAttribute('aria-label',
    dist.length
      ? `8×8 热力图，最近 ${fmt.mm(near)}，有效 ${tof.valid_count ?? '—'} 格，决策 ${ACTION_CN[action] || action}`
      : '8×8 热力图，暂无数据');
}

async function setAvoid(on) {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    await ctx.run('tof.op', { op: on ? 'on' : 'off' });
    toast(on ? '避障已开' : '避障已关（不再接管速度）', on ? 'ok' : 'warn');
  } catch { /* 已提示 */ }
}

function sendCfg(patch) {
  const ctx = ctxRef;
  if (!ctx) return;
  ctx.cmd('tof.op', { op: 'config', ...patch })
    .then(() => toast('避障参数已更新', 'ok', 1800))
    .catch((err) => toast(err.message || String(err), 'error'));
}
