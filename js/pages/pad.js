/* 手柄页：实体手柄状态 + 网页虚拟手柄（Pointer Events）+ 按键绑定。
   虚拟手柄和实体手柄共用 pad.op，谁在动听谁的；虚拟输入只在最近 5 s 内算"在用"。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, selectEl, toast,
} from '../ui.js';

const STICK_MS = 100;
const DEADZONE = 0.08;
const EXPO = 1.6;

const ACTIONS = [
  { value: 'none', label: '（不绑）' },
  { value: 'walk', label: '走路 walk' },
  { value: 'sitstand', label: '坐下/站起 sitstand' },
  { value: 'ground_pick', label: '地上捡东西' },
  { value: 'kick_left', label: '左脚踢' },
  { value: 'kick_right', label: '右脚踢' },
  { value: 'roulade', label: '前滚翻' },
  { value: 'stand', label: '站好 stand' },
  { value: 'sit_toggle', label: '坐下/站起（切换）' },
  { value: 'estop', label: '急停（卸力）' },
  { value: 'servo_restart', label: '重启舵机' },
  { value: 'gait_toggle', label: '切换步态' },
];

const BIND_KEYS = [
  ['a', '×'], ['b', '○'], ['x', '□'], ['y', '△'],
  ['lb', 'L1'], ['rb', 'R1'], ['l3', 'L3'], ['r3', 'R3'],
  ['dpad_up', '十字上'], ['dpad_down', '十字下'], ['dpad_left', '十字左'], ['dpad_right', '十字右'],
  ['select', 'Create'], ['start', 'Options'],
];

let unsub = null;
let ctxRef = null;
let el = {};
let seq = 0;
let timer = 0;
const activeSticks = new Set();
const axes = { lx: 0, ly: 0, rx: 0, ry: 0 };

export function page(ctx) {
  ctxRef = ctx;
  seq = 0;
  activeSticks.clear();
  axes.lx = 0; axes.ly = 0; axes.rx = 0; axes.ry = 0;

  /* ---------------- 状态卡 ---------------- */
  const connChip = h('div.row', {});
  const nameText = h('span.kv-v', {}, DASH);
  const battText = h('span.kv-v', {}, DASH);
  const sourceText = h('span.kv-v', {}, DASH);
  const hintText = h('div.hint-line', {});
  const candBox = h('div.stack-8', {});

  const scanBtn = btn('重新扫描', { icon: 'refresh', onClick: () => scan() });
  const pairBtn = btn('配对向导', { kind: 'outline', onClick: () => pairWizard() });

  const statusCard = card({ title: '手柄', sub: '实体优先，虚拟手柄随时可用' },
    connChip,
    h('div', { style: { marginTop: '8px' } },
      h('div.kv', {}, h('span.kv-k', '名称'), nameText),
      h('div.kv', {}, h('span.kv-k', '连接方式'), sourceText),
      h('div.kv', {}, h('span.kv-k', '电量'), battText),
      h('div.kv', {}, h('span.kv-k', '接收序号'), h('span.kv-v.mono', { id: 'pad-seq' }, DASH))),
    h('div.row', { style: { marginTop: '10px' } }, scanBtn, pairBtn),
    hintText, candBox);

  /* ---------------- SVG 手柄 ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  const knobL = mk('circle', { class: 'stick-knob', cx: 165, cy: 164, r: 16, 'data-stick': 'l' });
  const knobR = mk('circle', { class: 'stick-knob', cx: 395, cy: 164, r: 16, 'data-stick': 'r' });

  const gamepad = mk('svg', {
    class: 'pad-svg', viewBox: '0 0 560 330', role: 'group',
    'aria-label': '网页虚拟手柄：左右摇杆可拖，按键可点',
  });
  const add = (node) => { gamepad.append(node); return node; };

  // DualSense 风格壳体：宽肩、收腰握柄、顶部触控板；只绘制控制器造型，不复制 Sony 标识。
  add(mk('path', { class: 'body', d: 'M88 57 C111 33 148 31 179 39 L210 48 C253 60 307 60 350 48 L381 39 C412 31 449 33 472 57 C494 81 507 126 512 181 C516 224 497 250 469 245 C443 241 422 216 400 194 L374 171 C347 154 316 147 280 147 C244 147 213 154 186 171 L160 194 C138 216 117 241 91 245 C63 250 44 224 48 181 C53 126 66 81 88 57 Z' }));
  add(mk('path', { class: 'grip', d: 'M102 197 C105 237 123 284 148 310 C164 326 188 324 198 302 L216 251 L194 219 L156 199 Z' }));
  add(mk('path', { class: 'grip', d: 'M458 197 C455 237 437 284 412 310 C396 326 372 324 362 302 L344 251 L366 219 L404 199 Z' }));
  add(mk('path', { class: 'touchpad', d: 'M221 71 Q280 57 339 71 L331 112 Q280 122 229 112 Z' }));
  add(mk('path', { class: 'touchpad-seam', d: 'M280 66 L280 115' }));
  // L1 / R1 与扳机 L2 / R2
  add(mk('rect', { class: 'shoulder-key', x: 102, y: 26, width: 132, height: 22, rx: 11, 'data-key': 'lb' }));
  add(mk('rect', { class: 'shoulder-key', x: 326, y: 26, width: 132, height: 22, rx: 11, 'data-key': 'rb' }));
  add(mk('text', { class: 'shoulder-label', x: 168, y: 41, 'text-anchor': 'middle' })).textContent = 'L1';
  add(mk('text', { class: 'shoulder-label', x: 392, y: 41, 'text-anchor': 'middle' })).textContent = 'R1';
  add(mk('rect', { class: 'trigger-key', x: 117, y: 5, width: 104, height: 16, rx: 7 }));
  add(mk('rect', { class: 'trigger-key', x: 339, y: 5, width: 104, height: 16, rx: 7 }));
  add(mk('text', { class: 'tiny-label', x: 169, y: 17, 'text-anchor': 'middle' })).textContent = 'L2';
  add(mk('text', { class: 'tiny-label', x: 391, y: 17, 'text-anchor': 'middle' })).textContent = 'R2';

  // 不对称摇杆布置更接近 DualSense
  const wellL = add(mk('circle', { class: 'stick-well', cx: 182, cy: 176, r: 35 }));
  const wellR = add(mk('circle', { class: 'stick-well', cx: 310, cy: 238, r: 35 }));
  add(mk('circle', { class: 'stick-ring', cx: 182, cy: 176, r: 27 }));
  add(mk('circle', { class: 'stick-ring', cx: 310, cy: 238, r: 27 }));
  add(mk('line', { class: 'axis-mark', x1: 147, y1: 176, x2: 217, y2: 176 }));
  add(mk('line', { class: 'axis-mark', x1: 182, y1: 141, x2: 182, y2: 211 }));
  add(mk('line', { class: 'axis-mark', x1: 275, y1: 238, x2: 345, y2: 238 }));
  add(mk('line', { class: 'axis-mark', x1: 310, y1: 203, x2: 310, y2: 273 }));
  knobL.setAttribute('cx', '182'); knobL.setAttribute('cy', '176');
  knobR.setAttribute('cx', '310'); knobR.setAttribute('cy', '238');
  add(knobL); add(knobR);
  add(mk('circle', { class: 'stick-click', cx: 182, cy: 176, r: 9, 'data-key': 'l3' }));
  add(mk('circle', { class: 'stick-click', cx: 310, cy: 238, r: 9, 'data-key': 'r3' }));
  add(mk('text', { class: 'label', x: 182, y: 222, 'text-anchor': 'middle' })).textContent = 'L3';
  add(mk('text', { class: 'label', x: 310, y: 292, 'text-anchor': 'middle' })).textContent = 'R3';

  // D-pad 方向和图形符号
  const dpad = (cx, cy) => {
    const arms = [
      ['dpad_up', cx, cy - 20, 24, 28, '▲'], ['dpad_down', cx, cy + 20, 24, 28, '▼'],
      ['dpad_left', cx - 20, cy, 28, 24, '◀'], ['dpad_right', cx + 20, cy, 28, 24, '▶'],
    ];
    for (const [key, x, y, w, hgt, glyph] of arms) {
      add(mk('rect', { class: 'dpad btnface', x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, rx: 6, 'data-key': key }));
      add(mk('text', { class: 'dpad-glyph', x, y: y + 4, 'text-anchor': 'middle' })).textContent = glyph;
    }
    add(mk('rect', { class: 'dpad-center', x: cx - 12, y: cy - 12, width: 24, height: 24, rx: 4 }));
  };
  dpad(112, 151);

  // PS 布局的 △ ○ × □（只作为网页控制器符号）
  const faceBtn = (cx, cy, label, key, color) => {
    add(mk('circle', { class: 'face-button', cx, cy, r: 16, 'data-key': key, style: `--face-color:${color}` }));
    add(mk('text', { class: 'face-glyph', x: cx, y: cy + 5, 'text-anchor': 'middle', style: `--face-color:${color}` })).textContent = label;
  };
  faceBtn(426, 111, '△', 'y', '#148A56');
  faceBtn(454, 151, '○', 'b', '#E54B69');
  faceBtn(426, 191, '×', 'a', '#3988E8');
  faceBtn(398, 151, '□', 'x', '#C65BE5');

  // 中央控制键、Create / Options
  add(mk('circle', { class: 'home-key', cx: 280, cy: 144, r: 10, 'data-key': 'guide' }));
  add(mk('path', { class: 'home-mark', d: 'M274 144 Q280 136 286 144 Q280 152 274 144 Z' }));
  add(mk('rect', { class: 'center-key', x: 236, y: 127, width: 30, height: 15, rx: 7, 'data-key': 'select' }));
  add(mk('rect', { class: 'center-key', x: 294, y: 127, width: 30, height: 15, rx: 7, 'data-key': 'start' }));
  add(mk('text', { class: 'tiny-label', x: 251, y: 138, 'text-anchor': 'middle' })).textContent = 'CREATE';
  add(mk('text', { class: 'tiny-label', x: 309, y: 138, 'text-anchor': 'middle' })).textContent = 'OPTIONS';
  add(mk('text', { class: 'touch-label', x: 280, y: 93, 'text-anchor': 'middle' })).textContent = 'DUALSENSE STYLE';

  const padCard = card({ title: '网页虚拟手柄', sub: '拖摇杆 = 推摇杆；松手立刻停车' },
    gamepad,
    h('div.stick-read', {},
      axisBox('lx', '左右'), axisBox('ly', '前后'), axisBox('rx', '转向'), axisBox('ry', '备用')),
    h('div.row', { style: { marginTop: '10px', flexWrap: 'wrap' } },
      h('span.hint-line.grow', {}, '先启用驾驶，再推摇杆；Options 是急停卸力。IMU、策略或维护状态异常时不能启用。'),
      btn('启用驾驶', { size: 'sm', kind: 'primary', onClick: () => drive(true) }),
      btn('松开油门', { size: 'sm', kind: 'warn', onClick: () => drive(false) })));

  el = {
    connChip, nameText, battText, sourceText, hintText, candBox, scanBtn, pairBtn,
    gamepad, knobL, knobR, seqNode: null, axis: {},
  };

  bindStick(gamepad, knobL, 'l');
  bindStick(gamepad, knobR, 'r');
  gamepad.addEventListener('click', (e) => {
    const t = e.target.closest('[data-key]');
    if (!t) return;
    const key = t.dataset.key;
    tapKey(key, t);
  });

  const bindCard = card({ title: '按键绑定', sub: '绑到动作槽，不是绑到代码' }, h('div.bind-list'));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '手柄'),
        h('div.page-desc', '网页虚拟手柄采用 DualSense 风格布局；×/○/□/△、L1/R1、Create/Options 均可点按，Options 仍是急停。')), 
      h('div.page-head-actions', {},
        btn('去总控', { onClick: () => ctx.go('/') }))),
    h('div.pad-layout', {},
      h('div.stack', {}, padCard),
      h('div.pad-side', {}, statusCard, bindCard)));

  el.bindList = bindCard.body.querySelector('.bind-list');
  el.seqNode = statusCard.querySelector('#pad-seq');
  return pageEl;
}

function axisBox(key, label) {
  const v = h('div.v', {}, '0.00');
  const box = h('div', {}, h('div.k', `${key} · ${label}`), v);
  if (!axisBox.map) axisBox.map = {};
  axisBox.map[key] = v;
  return box;
}

export function mount(ctx) {
  ctxRef = ctx;
  axes.lx = axes.ly = axes.rx = axes.ry = 0;
  axisBox.map = {};
  unsub = ctx.store.subscribe(() => paint(ctx));
  buildBindings(ctx);
  paint(ctx);
  startStream();
}

export function unmount() {
  activeSticks.clear();
  axes.lx = axes.ly = axes.rx = axes.ry = 0;
  stopStream(true);
  if (unsub) unsub();
  unsub = null;
  if (unsubBind) unsubBind();
  unsubBind = null;
  ctxRef = null;
  el = {};
  axisBox.map = {};
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const pad = st.pad || {};
  const online = ctx.link.online;

  el.connChip.replaceChildren(
    chip(pad.connected ? '实体已连接' : pad.virtual ? '虚拟手柄在用' : '没有手柄', pad.connected ? 'ok' : pad.virtual ? 'info' : 'warn'),
    pad.armed ? chip('已进入驾驶', 'ok') : chip('未武装'),
    pad.mode ? chip(`模式 ${pad.mode}`) : null,
    pad.dropped ? chip(`丢弃 ${pad.dropped} 包`, 'warn') : null,
  );

  el.nameText.textContent = pad.name || (pad.virtual ? '网页虚拟手柄' : DASH);
  el.sourceText.textContent = pad.source === 'device' ? '实体（joydev/evdev）'
    : pad.source === 'virtual' ? '网页虚拟'
      : DASH;
  el.battText.textContent = pad.battery == null ? '—（joydev 不上报电量）' : fmt.pct(pad.battery);
  el.hintText.textContent = pad.note || pad.hint || (online ? '先点击启用驾驶；Options 是急停' : '连接断了');

  el.scanBtn.disabled = !online;
  el.pairBtn.disabled = !online;

  const cands = pad.candidates || [];
  el.candBox.replaceChildren();
  if (cands.length) {
    el.candBox.append(h('div.subhead', { style: { marginTop: '8px' } }, `扫到 ${cands.length} 个设备`),
      ...cands.slice(0, 4).map((c) => h('div.row-between', { style: { padding: '3px 0' } },
        h('span.mono', { style: { fontSize: '11.5px' } }, c.name || c.path || '—'),
        btn('用它', { size: 'sm', onClick: () => pair(c.path || c.name) }))));
  }

  if (el.seqNode) el.seqNode.textContent = pad.seq === undefined ? DASH : String(pad.seq);

  // 摇杆读数：本地拖动优先（后端 10 Hz 回来会晚）
  const a = activeSticks.size ? axes : (pad.axes || {});
  for (const k of ['lx', 'ly', 'rx', 'ry']) {
    const node = axisBox.map && axisBox.map[k];
    if (!node) continue;
    const v = Number(a[k] ?? 0);
    node.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    node.style.color = Math.abs(v) > DEADZONE ? 'var(--brand-ink)' : 'var(--ink-3)';
  }

  // 速度
  const sp = pad.speed || {};
  const spNode = el.gamepad?.parentElement?.querySelector('.stick-read');
  if (spNode) spNode.title = `vx ${fmt.f2(sp.vx)} m/s · wz ${fmt.f2(sp.wz)} rad/s`;
}

/* ---------------------------------------------------------------- 摇杆 */
function bindStick(svg, knob, side) {
  const cx = side === 'l' ? 182 : 310;
  const cy = side === 'l' ? 176 : 238;
  const R = 35;

  const toLocal = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: cx, y: cy };
    const p = pt.matrixTransform(m.inverse());
    return p;
  };

  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    knob.classList.add('is-live');
    activeSticks.add(side);
    const p = toLocal(e);
    updateStick(side, p.x, p.y, knob, cx, cy, R);
    startStream();
  });

  knob.addEventListener('pointermove', (e) => {
    if (!knob.hasPointerCapture || !knob.hasPointerCapture(e.pointerId)) return;
    const p = toLocal(e);
    updateStick(side, p.x, p.y, knob, cx, cy, R);
  });

  const end = (e) => {
    if (knob.hasPointerCapture && knob.hasPointerCapture(e.pointerId)) {
      knob.releasePointerCapture(e.pointerId);
    }
    knob.classList.remove('is-live');
    knob.setAttribute('cx', cx);
    knob.setAttribute('cy', cy);
    if (side === 'l') { axes.lx = 0; axes.ly = 0; } else { axes.rx = 0; axes.ry = 0; }
    activeSticks.delete(side);
    if (activeSticks.size === 0) stopStickInput();
    else sendSticks();
    paint(ctxRef);
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  knob.addEventListener('lostpointercapture', () => {
    if (!knob.classList.contains('is-live')) return;
    knob.classList.remove('is-live');
    knob.setAttribute('cx', cx);
    knob.setAttribute('cy', cy);
    if (side === 'l') { axes.lx = 0; axes.ly = 0; } else { axes.rx = 0; axes.ry = 0; }
    activeSticks.delete(side);
    if (activeSticks.size === 0) stopStickInput();
    else sendSticks();
    paint(ctxRef);
  });
}

function updateStick(side, px, py, knob, cx, cy, R) {
  let dx = px - cx;
  let dy = py - cy;
  const len = Math.hypot(dx, dy);
  if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
  knob.setAttribute('cx', cx + dx);
  knob.setAttribute('cy', cy + dy);
  const nx = clamp1(dx / R);
  const ny = clamp1(dy / R);
  if (side === 'l') { axes.lx = nx; axes.ly = ny; } else { axes.rx = nx; axes.ry = ny; }
  paint(ctxRef);
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, Number(v) || 0));
}

/** 死区 + 指数曲线：和后端 DEADZONE / EXPO 一致，只是显示用 */
export function shape(v) {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * Math.pow((a - DEADZONE) / (1 - DEADZONE), EXPO);
}

function sendSticks() {
  if (!ctxRef || !ctxRef.link.online) return;
  seq += 1;
  ctxRef.cmd('pad.sticks', {
    op: 'sticks',
    seq,
    lx: round3(axes.lx),
    ly: round3(axes.ly),
    rx: round3(axes.rx),
    ry: round3(axes.ry),
    mode: 'drive',
  }).catch(() => {});
}

function startStream() {
  if (timer) return;
  sendSticks();
  timer = setInterval(sendSticks, STICK_MS);
}

function stopStream(sendStop) {
  clearInterval(timer);
  timer = 0;
  if (sendStop && ctxRef && ctxRef.link.online) {
    // Leaving the page revokes driving, not just the current velocity.
    ctxRef.cmd('pad.op', { op: 'drive', on: false }).catch(() => {});
  }
}

function stopStickInput() {
  sendSticks();
  if (ctxRef?.link.online) ctxRef.cmd('pad.stop', {}).catch(() => {});
}

function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

/* ---------------------------------------------------------------- 按键 */
async function tapKey(key, node) {
  if (!ctxRef) return;
  node.classList.add('is-down');
  setTimeout(() => node.classList.remove('is-down'), 140);
  if (key === 'start') {
    // Start = 急停，走和顶栏红键同一条路
    try {
      const data = await ctxRef.cmd('relax', {}, { timeout: 8000 });
      if (data && data.ok === false) toast(data.error || '卸力没成功', 'error');
      else toast(data?.state === 'pending' ? (data.note || '已提交急停请求，等待硬件确认') : '已全部卸力', 'ok');
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
    return;
  }
  try {
    await ctxRef.run('pad.op', { op: 'key', key });
  } catch { /* 已提示 */ }
}

function drive(on) {
  if (!ctxRef) return;
  ctxRef.run('pad.op', { op: 'drive', on }).catch(() => {});
}

/* ---------------------------------------------------------------- 扫描/配对 */
async function scan() {
  if (!ctxRef) return;
  try {
    const res = await ctxRef.run('pad.op', { op: 'scan' });
    toast(res?.found ? `扫到 ${res.found} 个设备` : '没扫到设备：检查 USB 或系统蓝牙配对', res?.found ? 'ok' : 'warn');
  } catch { /* 已提示 */ }
}

async function pair(path) {
  if (!ctxRef) return;
  try {
    const res = await ctxRef.run('pad.op', { op: 'pair', path }, { timeout: 15000 });
    toast(`已选中 ${res?.name || path}`, 'ok');
  } catch { /* 已提示 */ }
}

async function pairWizard() {
  if (!ctxRef) return;
  let chosen = null;
  const list = h('div.stack-8', {}, h('div.hint-line', {}, '先点「扫描」，再选一个设备。无线手柄请先在系统里做蓝牙配对。'));
  const ok = await ctxRef.confirm({
    title: '配对向导',
    sub: '选设备 → 打开它 → 回这一页试摇杆',
    body: h('div.stack', {},
      h('div.row', {}, btn('扫描', { icon: 'refresh', onClick: async () => {
        try {
          const res = await ctxRef.run('pad.op', { op: 'scan' });
          list.replaceChildren();
          const devs = res?.devices || [];
          if (!devs.length) {
            list.append(h('div.note.note-warn', {}, icon('alert', 15),
              h('div', {}, '没扫到 /dev/input 里的手柄。插 USB 线试一次；无线要先在系统蓝牙里配好。')));
            return;
          }
          for (const d of devs) {
            list.append(h('button', {
              class: 'wifi-item', type: 'button',
              onclick: (e) => {
                chosen = d.path || d.name;
                for (const b of list.querySelectorAll('.wifi-item')) b.style.background = '';
                e.currentTarget.style.background = 'var(--brand-050)';
              },
            }, icon('pad', 15), h('span.ssid', d.name || d.path), h('span.sig', d.kind || '')));
          }
        } catch { /* 已提示 */ }
      } })),
      list),
    okText: '用它',
  });
  if (!ok || !chosen) return;
  await pair(chosen);
}

/* ---------------------------------------------------------------- 绑定表 */
function buildBindings(ctx) {
  const pad = get(ctx.state(), 'pad.bindings', {}) || {};
  if (!el.bindList) return;
  el.bindList.replaceChildren(...BIND_KEYS.map(([key, label]) => {
    const sel = selectEl(ACTIONS, pad[key] || 'none', (v) => {
      ctx.run('pad.op', { op: 'bind', button: key, slot: v })
        .then(() => toast(`${label} → ${ACTIONS.find((a) => a.value === v)?.label || v}`, 'ok', 2000))
        .catch(() => {});
    }, { label: `${label} 绑定的动作` });
    sel.dataset.key = key;
    return h('div.bind-row', {}, h('span.bind-key', label), sel);
  }));

  // 状态回来时同步一次（别人改了绑定也能看到）
  unsubBind = ctx.store.subscribe(() => {
    const b = get(ctx.state(), 'pad.bindings', {}) || {};
    for (const sel of el.bindList.querySelectorAll('select[data-key]')) {
      const v = b[sel.dataset.key] || 'none';
      if (sel.value !== v) sel.value = v;
    }
  });
}

let unsubBind = null;
