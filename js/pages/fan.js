/* 风扇页：两路 PWM + 转速表 + 温控曲线。
   手动滑块 300 ms 节流；曲线用 SVG 折线，三个点可拖（温度→转速，阶梯判据）。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, throttle, toast, svg,
} from '../ui.js';

const T_MIN = 30;
const T_MAX = 90;
const W = 320;
const H = 170;
const PAD = { l: 30, r: 10, t: 12, b: 22 };

let unsub = null;
let ctxRef = null;
let el = {};
let curve = [[58, 70], [64, 85], [70, 100]];
let dragging = -1;

export function page(ctx) {
  ctxRef = ctx;
  dragging = -1;

  /* ---------------- 两张卡 ---------------- */
  const cards = [0, 1].map((i) => fanCard(i));

  /* ---------------- 模式 ---------------- */
  const seg = h('div.seg', { role: 'group', 'aria-label': '风扇模式' },
    h('button', { type: 'button', 'data-mode': 'auto', 'aria-pressed': 'false' }, '自动（曲线）'),
    h('button', { type: 'button', 'data-mode': 'manual', 'aria-pressed': 'false' }, '手动'));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    setMode(b.dataset.mode);
  });

  const selfTestBtn = btn('自检', { icon: 'refresh', onClick: () => selfTest() });
  const modeCard = card({ title: '模式', sub: '重启后回到自动，避免忘记手动全速' },
    h('div.row-between', {}, seg, selfTestBtn),
    h('div.hint-line', { style: { marginTop: '8px' } },
      '自动：按曲线每 2 秒判一次。手动：锁在你给的值，直到切回自动。'));

  /* ---------------- 曲线 ---------------- */
  const curveSvg = svg('svg', { class: 'curve-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '温控曲线' });
  const serverNote = h('div.hint-line', {});
  const curveCard = card({ title: '温控曲线', sub: '拖三个点：温度 → 转速' },
    h('div.curve-wrap', {}, curveSvg),
    serverNote,
    h('div.row', { style: { marginTop: '10px' } },
      btn('恢复默认', { size: 'sm', onClick: () => sendCurve([[58, 70], [64, 85], [70, 100]]) })));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '风扇'),
        h('div.page-desc', '两路 PWM：顶部 PWM14 / 主板 PWM12。主板那颗带测速，顶部没有测速。')),
      h('div.page-head-actions', {}, h('span', { id: 'fan-chips' }))),
    h('div.fan-cards', {}, ...cards.map((c) => c.el)),
    h('div.grid-2', {}, modeCard, curveCard));

  el = { cards, seg, curveSvg, serverNote, chips: pageEl.querySelector('#fan-chips') };
  drawCurve();
  return pageEl;
}

function fanCard(index) {
  const pct = h('span.live-num', {}, DASH);
  const rpm = h('div.sub', {}, DASH);
  const temp = h('div.sub', {}, '');
  const pin = h('div.pin', {}, '—');
  const slider = h('input', {
    type: 'range', min: '0', max: '100', step: '5', value: '60',
    style: { width: '100%', marginTop: '8px' },
    'aria-label': `风扇 ${index} 手动转速`,
  });
  const fire = throttle((v) => {
    ctxRef.cmd('fan.op', { op: 'manual', index, pct: v })
      .then(() => { /* 状态会回来，不乐观更新 */ })
      .catch((err) => toast(err.message || String(err), 'error'));
  }, 300);
  slider.addEventListener('input', () => fire(Number(slider.value)));

  const cardEl = h('div.fan-card', {},
    h('div.hd', {}, h('div', {}, h('div.nm', index === 0 ? '顶部风扇' : '主板散热'), pin),
      h('span', { class: 'chip' }, `#${index}`)),
    h('div.big', {}, pct, h('span.unit', '%')),
    rpm, temp,
    slider,
    h('div.hint-line', { style: { marginTop: '4px' } }, index === 1 ? '4pin，带转速表' : '2pin，无测速'));

  return { el: cardEl, pct, rpm, temp, pin, slider, index };
}

export function mount(ctx) {
  ctxRef = ctx;
  bindCurveDrag(ctx);
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  ctxRef = null;
  el = {};
  dragging = -1;
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const fan = st.fan || {};
  const items = fan.items || [];
  const available = fan.available !== false;
  const mode = fan.mode === 'manual' ? 'manual' : 'auto';

  el.seg.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });

  el.cards.forEach((c, i) => {
    const it = items[i] || {};
    const p = it.pct ?? (i === 0 ? fan.pct : null);
    c.pct.replaceChildren(h('span.live-num', p == null ? DASH : fmt.int(p)), h('span.unit', '%'));
    c.rpm.textContent = it.rpm == null
      ? '转速 —（这颗没有测速）'
      : `${fmt.int(it.rpm)} RPM${it.tach_hz != null ? ` · ${fmt.f1(it.tach_hz)} Hz` : ''}`;
    c.temp.textContent = `温度 ${fan.temp == null ? DASH : fmt.deg(fan.temp)}`;
    c.pin.textContent = it.pwm != null
      ? `PWM${it.pwm} · GPIO${it.gpio ?? '—'}${it.name ? ` · ${it.name}` : ''}`
      : (it.name || '—');
    const val = p == null ? 0 : Math.round(p);
    if (document.activeElement !== c.slider) c.slider.value = String(val);
    c.slider.disabled = !available || !ctx.link.online;
    c.slider.title = available ? '' : '这台机器没有真风扇，手动值只是演示';
  });

  const chips = [];
  chips.push(chip(mode === 'auto' ? '自动' : '手动', mode === 'auto' ? 'ok' : 'warn'));
  if (!available) chips.push(chip('没有风扇控制器', 'danger'));
  if (fan.virtual) chips.push(chip('手动值是演示值', 'warn'));
  if (fan.source) chips.push(chip(fan.source === 'hal' ? 'HAL 直连' : fan.source));
  el.chips.replaceChildren(...chips);

  if (!available) {
    el.serverNote.textContent = `${fan.reason || '风扇不可用'}${fan.hint ? ` · ${fan.hint}` : ''}`;
    el.serverNote.style.color = 'var(--warn-ink)';
  } else if (fan.virtual) {
    el.serverNote.textContent = fan.reason || '没有真实控制器：滑块只改演示值。';
    el.serverNote.style.color = 'var(--warn-ink)';
  } else {
    el.serverNote.textContent = '曲线是阶梯判据：temp ≥ 台阶温度就用那一档，都不满足走 60%。';
    el.serverNote.style.color = '';
  }

  const serverCurve = Array.isArray(fan.curve) && fan.curve.length ? fan.curve : null;
  if (serverCurve && dragging < 0) {
    const same = serverCurve.length === curve.length
      && serverCurve.every((p, i) => Number(p[0]) === curve[i][0] && Number(p[1]) === curve[i][1]);
    if (!same) {
      curve = serverCurve.map((p) => [Number(p[0]), Number(p[1])]);
      drawCurve();
    }
  }
  drawCurve(fan.temp);
}

/* ---------------------------------------------------------------- 曲线绘制 */
function sx(t) {
  return PAD.l + ((clamp(t, T_MIN, T_MAX) - T_MIN) / (T_MAX - T_MIN)) * (W - PAD.l - PAD.r);
}
function sy(p) {
  return H - PAD.b - (clamp(p, 0, 100) / 100) * (H - PAD.t - PAD.b);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function drawCurve(tempNow) {
  const host = el.curveSvg;
  if (!host) return;
  host.replaceChildren();

  // 网格
  for (let i = 0; i <= 4; i += 1) {
    const y = PAD.t + (i / 4) * (H - PAD.t - PAD.b);
    host.append(svg('line', { class: 'grid', x1: PAD.l, x2: W - PAD.r, y1: y, y2: y }));
    const label = svg('text', { class: 'tick', x: 2, y: y + 3 });
    label.textContent = String(100 - i * 25);
    host.append(label);
  }
  for (let t = T_MIN; t <= T_MAX; t += 20) {
    const x = sx(t);
    host.append(svg('line', { class: 'grid', x1: x, x2: x, y1: PAD.t, y2: H - PAD.b }));
    const label = svg('text', { class: 'tick', x, y: H - 6, 'text-anchor': 'middle' });
    label.textContent = `${t}°`;
    host.append(label);
  }
  host.append(svg('line', { class: 'axis', x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b }));
  host.append(svg('line', { class: 'axis', x1: PAD.l, x2: PAD.l, y1: PAD.t, y2: H - PAD.b }));

  const pts = curve.map(([t, p]) => [sx(t), sy(p)]);
  const base = sy(60);
  // 阶梯：30° → 第一台阶前 60%，之后每段先水平再竖直
  let d = `M ${sx(T_MIN)} ${base}`;
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = pts[i];
    d += ` L ${x} ${i === 0 ? base : pts[i - 1][1]}`;
    d += ` L ${x} ${y}`;
  }
  const lastX = sx(T_MAX);
  d += ` L ${lastX} ${pts.length ? pts[pts.length - 1][1] : base}`;
  host.append(svg('path', { class: 'area', d: `${d} L ${lastX} ${H - PAD.b} L ${sx(T_MIN)} ${H - PAD.b} Z` }));
  host.append(svg('path', { class: 'line', d }));

  // 当前温度参考线
  if (Number.isFinite(Number(tempNow))) {
    const x = sx(Number(tempNow));
    host.append(svg('line', { class: 'guide', x1: x, x2: x, y1: PAD.t, y2: H - PAD.b }));
    const t = svg('text', { class: 'tick', x: clamp(x + 4, PAD.l, W - 40), y: PAD.t + 10 });
    t.textContent = `${Math.round(tempNow)}°`;
    host.append(t);
  }

  // 三个拖点
  curve.forEach(([t, p], i) => {
    const circle = svg('circle', {
      class: 'pt', cx: sx(t), cy: sy(p), r: 6,
      'data-i': i, tabindex: '0', role: 'slider',
      'aria-label': `曲线点 ${i + 1}：${Math.round(t)} 度 → ${Math.round(p)}%`,
      'aria-valuetext': `${Math.round(t)} 度 ${Math.round(p)}%`,
    });
    host.append(circle);
    const label = svg('text', { class: 'tick', x: sx(t) + 9, y: sy(p) - 8 });
    label.textContent = `${Math.round(t)}°/${Math.round(p)}%`;
    host.append(label);
  });
}

function bindCurveDrag(ctx) {
  const host = el.curveSvg;
  if (!host) return;

  const toData = (evt) => {
    const rect = host.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * W;
    const y = ((evt.clientY - rect.top) / rect.height) * H;
    const t = T_MIN + ((x - PAD.l) / (W - PAD.l - PAD.r)) * (T_MAX - T_MIN);
    const p = ((H - PAD.b - y) / (H - PAD.t - PAD.b)) * 100;
    return [Math.round(clamp(t, T_MIN, T_MAX)), Math.round(clamp(p, 0, 100))];
  };

  const move = (evt) => {
    if (dragging < 0) return;
    const [t, p] = toData(evt);
    const lo = dragging === 0 ? T_MIN : curve[dragging - 1][0] + 1;
    const hi = dragging === curve.length - 1 ? T_MAX : curve[dragging + 1][0] - 1;
    curve[dragging] = [Math.round(clamp(t, lo, hi)), p];
    drawCurve();
  };

  const up = () => {
    if (dragging < 0) return;
    dragging = -1;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    sendCurve(curve.map((p) => [...p]));
  };

  host.addEventListener('pointerdown', (e) => {
    const pt = e.target.closest('.pt');
    if (!pt) return;
    e.preventDefault();
    dragging = Number(pt.dataset.i);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  host.addEventListener('keydown', (e) => {
    const pt = e.target.closest('.pt');
    if (!pt) return;
    const i = Number(pt.dataset.i);
    const step = e.shiftKey ? 5 : 1;
    let [t, p] = curve[i];
    if (e.key === 'ArrowLeft') t -= step;
    else if (e.key === 'ArrowRight') t += step;
    else if (e.key === 'ArrowUp') p += step;
    else if (e.key === 'ArrowDown') p -= step;
    else return;
    e.preventDefault();
    const lo = i === 0 ? T_MIN : curve[i - 1][0] + 1;
    const hi = i === curve.length - 1 ? T_MAX : curve[i + 1][0] - 1;
    curve[i] = [Math.round(clamp(t, lo, hi)), Math.round(clamp(p, 0, 100))];
    drawCurve();
    sendCurve(curve.map((q) => [...q]));
  });
}

/* ---------------------------------------------------------------- 命令 */
function setMode(mode) {
  const ctx = ctxRef;
  if (!ctx) return;
  const args = mode === 'auto'
    ? { op: 'auto' }
    : { op: 'manual', index: 0, pct: Number(el.cards[0]?.slider?.value ?? 60) };
  ctx.run('fan.op', args)
    .then(() => toast(mode === 'auto' ? '已切自动' : '已切手动（只作用在 0 号风扇）', 'ok', 2200))
    .catch(() => {});
}

function sendCurve(next) {
  const ctx = ctxRef;
  if (!ctx) return;
  curve = next.map((p) => [Number(p[0]), Number(p[1])]);
  drawCurve(ctx.state()?.fan?.temp);
  ctx.cmd('fan.op', { op: 'curve', curve })
    .then(() => toast('曲线已保存', 'ok', 1800))
    .catch((err) => toast(err.message || String(err), 'error'));
}

async function selfTest() {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    const res = await ctx.run('fan.op', { op: 'self_test' }, { timeout: 15000 });
    if (res?.ok === null || res?.available === false) {
      toast(res.reason || '这台机器没法自检', 'warn', 6000);
    } else if (res?.ok) {
      toast(`自检通过：${res.rpm ?? '—'} RPM`, 'ok', 5000);
    } else {
      toast(res?.reason || '自检没过：转速没上来，检查供电和 4pin 线', 'error', 7000);
    }
  } catch { /* 已提示 */ }
}
