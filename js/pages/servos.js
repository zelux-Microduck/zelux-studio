/* 舵机页：接管会话 + 15 颗分组表 + 0 位微调 + 官方姿势 + 寄存器编辑。
   危险寄存器（5/6/8/9/11/18/19/33）先标红，写入前再确认一次。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, selectEl, toast, toastError,
} from '../ui.js';
import { createDuck, JOINTS } from '../duck2d.js';

const GROUPS = [
  { name: '右腿', ids: [10, 11, 12, 13, 14] },
  { name: '左腿', ids: [20, 21, 22, 23, 24] },
  { name: '头颈', ids: [30, 31, 32, 33, 34] },
];
const NAME_CN = {
  10: '右髋偏转', 11: '右髋侧摆', 12: '右髋俯仰', 13: '右膝', 14: '右踝',
  20: '左髋偏转', 21: '左髋侧摆', 22: '左髋俯仰', 23: '左膝', 24: '左踝',
  30: '脖子左右', 31: '脖子俯仰', 32: '头左右', 33: '头俯仰', 34: '喙',
};

const REGS = [
  [5, 'ID'], [6, '波特率'], [8, '应答级别'], [9, '最小限位'], [11, '最大限位'],
  [16, '最大扭矩'], [18, '方向（相位）'], [19, '卸载保护'], [21, '位置 P'],
  [22, '位置 D'], [23, '位置 I'], [24, '力矩 P'], [26, '力矩 I'],
  [31, '0 位偏移'], [33, '运行模式'], [40, '扭矩开关'], [41, '目标位置'],
  [42, '加速度'], [44, '目标速度'],
];

const DANGER = {
  5: '改 ID 后这颗就再也找不到了，只能单独接上、用新 ID 重新扫。',
  6: '改了波特率整条总线立刻失联，得单颗用默认波特率救回来。',
  8: '应答级别改成不回复，之后所有读取都会超时。',
  9: '限位设反会让关节顶死在机构上，堵转几秒就烫手。',
  11: '限位设反会让关节顶死在机构上，堵转几秒就烫手。',
  18: '方向反了姿势就是镜像的，两条腿会互相打架。',
  19: '关掉卸载保护后堵转不卸力，会烧线圈。',
  33: '运行模式不对时，位置指令会变成电机一直转。',
};

const POSE_OPTIONS = [
  { value: '', label: '官方姿势…' },
  { value: 'zero', label: '零位（全部 2048）' },
  { value: 'stand', label: '站姿 stand' },
  { value: 'sit', label: '坐姿 sit' },
  { value: 'fold', label: '折叠 fold' },
];

let duck = null;
let unsub = null;
let pageCtx = null;
let expanded = null;
let readCache = new Map();
let el = {};
let lastItemsKey = '';

export function page(ctx) {
  pageCtx = ctx;
  expanded = null;
  readCache = new Map();

  const canvas = h('canvas', { 'aria-label': 'MicroDuck 真实三维模型，点舵机可展开对应行，拖动可旋转' });
  const viewSeg = h('div.seg', {},
    h('button', { type: 'button', 'aria-pressed': 'true', 'data-v': 'side' }, '侧视'),
    h('button', { type: 'button', 'aria-pressed': 'false', 'data-v': 'front' }, '正视'));

  const poseSelect = selectEl(POSE_OPTIONS, '', (v) => {
    if (!v) return;
    poseSelect.value = '';
    ctx.run('servo.pose', { name: v }).then((res) => {
      toast(`已到「${v}」姿势（${res?.speed ?? '—'} 步/秒）`, 'ok');
    }).catch(() => {});
  }, { label: '官方姿势' });

  const actCard = card({ title: '标定动作', sub: '都需要先接管总线' },
    h('div.stack-8', {},
      h('div.row.wrap', {}, poseSelect,
        btn('一键中位', { onClick: () => pose('zero') }),
        btn('撤销上一步', { icon: 'refresh', onClick: () => ctx.run('servo.undo', {}).then(() => toast('已撤销', 'ok')).catch(() => {}) })),
      h('div.divider'),
      h('div.row.wrap', {},
        btn('全部保持', { onClick: () => torque(true) }),
        btn('全部松开', { kind: 'warn', onClick: () => torque(false) })),
      h('div.hint-line', {}, '「松开」会卸力，鸭子会软下来——扶一下。急停请按顶栏红键。')));

  const board = h('div.srv-board');
  const scroll = h('div', { style: { overflowX: 'auto' } }, board);

  const takeover = h('div.takeover');
  const header = h('div.row-between', {},
    h('div', {},
      h('h1.page-title', '舵机'),
      h('div.page-desc', '15 颗 · 右腿 10–14 / 左腿 20–24 / 头颈 30–34。点行展开详情，点左边关节也能展开。')),
    h('div.page-head-actions', {},
      btn('读取全部', { icon: 'refresh', onClick: () => readAll() }),
      btn('回总控', { onClick: () => ctx.go('/') })));

  const pageEl = h('div.page', {}, header, takeover,
    h('div.srv-layout', {},
      h('div.stack', {},
        card({ title: '姿态', sub: '参考站 CAD 三维模型 · 15 颗舵机角实时驱动 · 拖动旋转', tight: true },
          h('div.srv-visual', {}, h('div.panel-stage.on-stage', { style: { padding: '8px' } }, canvas),
            h('div.row-between', { style: { marginTop: '8px' } }, viewSeg,
              h('span.hint-line', {}, '点关节高亮')),
            h('div.srv-hint', {}, '使用 MicroDuck CAD 网格实时渲染。点模型中的舵机可定位对应行；舵机刻度按 2048 中位换算为弧度，仅供姿态预览，偏移与方向需上机校准。'))),
        actCard),
      card({ title: '舵机表', sub: '位置/负载/电压/温度来自总线缓存' }, scroll,
        h('div.hint-line', { style: { marginTop: '8px' } },
          '电压/负载/温度是原始读数；P/D 等参数需要单颗读取，后端没上报时显示 —。'))));

  el = { canvas, viewSeg, board, takeover, actCard, poseSelect, scroll };
  duck = createDuck(canvas, { mode: 'side', fill: 0.76 });
  duck.onPick = (id) => focusJoint(id, false);

  viewSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    for (const x of viewSeg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    duck?.setMode(b.dataset.v);
  });

  return pageEl;
}

export function mount(ctx) {
  pageCtx = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  pageCtx = null;
  duck?.destroy();
  duck = null;
  el = {};
  expanded = null;
  readCache = new Map();
  lastItemsKey = '';
}

/* ---------------------------------------------------------------- 状态 */
function session(ctx) {
  return ctx.state()?.servo_session || null;
}

function paint(ctx) {
  const st = ctx.state() || {};
  const sess = st.servo_session;
  const online = ctx.link.online;
  const items = get(st, 'servos.items', []) || [];
  const draft = get(st, 'servos.draft', {}) || {};

  // 接管条
  if (sess) {
    el.takeover.className = 'takeover is-on';
    el.takeover.replaceChildren(
      icon('check', 15),
      h('span.grow', {},
        `已接管总线 · ${sess.online ?? '—'}/15 在线 · ${sess.holding ?? '—'} 颗保持`,
        h('span.mono', { style: { marginLeft: '8px' } }, sess.took_ms != null ? `${sess.took_ms} ms` : ''),
        draft.dirty ? h('span.mono', { style: { marginLeft: '8px' } }, `草稿 ${draft.dirty} 处改动待写入`) : null),
      btn('交还主程序', { size: 'sm', onClick: () => release(ctx) }));
  } else {
    el.takeover.className = 'takeover';
    el.takeover.replaceChildren(
      icon('alert', 15),
      h('span.grow', {}, online
        ? '只读：还没接管总线，改不了任何东西。接管后主程序会停，手柄失效。'
        : '连接断了：接管要先连上设备。'),
      btn('开始调舵机', { kind: 'primary', size: 'sm', disabled: !online, onClick: () => take(ctx) }));
  }

  // 姿态
  duck?.setState(st);
  duck?.setHighlight(expanded);

  // 表：只在数据形状变了（在线数/id 列表）时重建，其余只改数值
  const key = `${items.length}|${draft.dirty}|${sess ? 1 : 0}`;
  if (key !== lastItemsKey) {
    lastItemsKey = key;
    buildTable(ctx, items);
  }
  updateRows(items, draft, sess);

  el.poseSelect.disabled = !sess;
}

async function take(ctx) {
  try {
    const res = await ctx.run('servo.bus', { op: 'take' }, { timeout: 15000 });
    toast(`已接管：${res?.online ?? '—'}/15 在线${res?.missing?.length ? `，缺 ${res.missing.join('、')}` : ''}`, 'ok', 4200);
  } catch { /* 已提示 */ }
}

async function release(ctx) {
  try {
    await ctx.run('servo.bus', { op: 'release' });
    toast('已交还主程序（舵机仍保持着）', 'ok');
  } catch { /* 已提示 */ }
}

function torque(on) {
  pageCtx.run('servo.torque', { on }).then(() => toast(on ? '全部加力' : '全部卸力', on ? 'ok' : 'warn')).catch(() => {});
}

function pose(name) {
  pageCtx.run('servo.pose', { name }).then(() => toast(`已到 ${name} 姿势`, 'ok')).catch(() => {});
}

/* ---------------------------------------------------------------- 表 */
function buildTable(ctx, items) {
  const byId = new Map(items.map((it) => [Number(it.id), it]));
  el.board.replaceChildren();
  el.board.append(h('div.srv-head', {},
    h('span', 'ID'), h('span', '名称'), h('span.cell', '位置'), h('span.cell', '负载'),
    h('span.cell', '电压'), h('span.cell', '温度'), h('span.cell', '扭矩')));

  for (const g of GROUPS) {
    el.board.append(h('div.srv-group', {},
      h('span', g.name),
      h('span.ids', g.ids.join(' · '))));
    for (const id of g.ids) {
      const it = byId.get(id) || null;
      const row = h('div.srv-row', {
        role: 'button',
        tabindex: '0',
        'aria-expanded': String(expanded === id),
        dataset: { id: String(id) },
        onclick: () => focusJoint(id),
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); focusJoint(id); }
        },
      },
      h('span.id', String(id)),
      h('span.nm', { title: JOINTS.find((j) => j.id === id)?.key || '' }, NAME_CN[id] || '—'),
      cell('pos', it ? fmt.int(it.pos) : DASH),
      cell('load', it ? fmt.f1(it.load) : DASH),
      cell('volt', it ? fmt.f2(it.volt) : DASH),
      cell('temp', it ? fmt.f1(it.temp) : DASH),
      h('span.torque-cell', {}, torqueSwitch(id, it)));
      el.board.append(row);
      if (expanded === id) el.board.append(detailRow(ctx, id));
    }
  }
}

function cell(name, value) {
  return h('span.cell', { class: name }, value);
}

function torqueSwitch(id, it) {
  const on = it ? it.torque !== false : false;
  const sw = h('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': `${id} 号扭矩开关`,
    disabled: !session(pageCtx),
  });
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = sw.getAttribute('aria-checked') !== 'true';
    if (!session(pageCtx)) { toast('先接管总线才能改扭矩', 'warn'); return; }
    pageCtx.run('servo.torque', { on: next, ids: [id] }).then(() => {
      sw.setAttribute('aria-checked', next ? 'true' : 'false');
    }).catch(() => {});
  });
  return sw;
}

function updateRows(items, draft, sess) {
  const byId = new Map(items.map((it) => [Number(it.id), it]));
  for (const row of el.board.querySelectorAll('.srv-row')) {
    const id = Number(row.dataset.id);
    const it = byId.get(id);
    const set = (cls, v) => {
      const n = row.querySelector(`.${cls}`);
      if (n && n.textContent !== String(v)) n.textContent = String(v);
    };
    set('pos', it ? fmt.int(it.pos) : DASH);
    set('load', it ? fmt.f1(it.load) : DASH);
    set('volt', it ? fmt.f2(it.volt) : DASH);
    const temp = it ? it.temp : null;
    set('temp', temp == null ? DASH : fmt.f1(temp));
    row.querySelector('.temp')?.classList.toggle('hot', typeof temp === 'number' && temp >= 65);
    const off = it && it.torque === false;
    row.classList.toggle('is-off', Boolean(off));
    const sw = row.querySelector('.switch');
    if (sw) {
      if (it) sw.setAttribute('aria-checked', it.torque === false ? 'false' : 'true');
      sw.disabled = !sess;
    }
  }
  const det = el.board.querySelector('.srv-detail');
  if (det && expanded != null) updateDetail(det, expanded);
}

/* ---------------------------------------------------------------- 详情 */
function detailRow(ctx, id) {
  const draft = get(ctx.state(), 'servos.draft', {}) || {};
  const rec = readCache.get(id);
  const box = h('div.srv-detail', { dataset: { id: String(id) } });

  const val = (key) => rec?.[key] ?? null;
  const offset = val('offset') ?? get(draft, `items.${id}.offset`);
  const direction = get(draft, `items.${id}.direction`) ?? val('direction');
  const min = get(draft, `items.${id}.min`) ?? val('min');
  const max = get(draft, `items.${id}.max`) ?? val('max');
  const p = val('p') ?? val('pos_p') ?? val('kp');
  const d = val('d') ?? val('pos_d') ?? val('kd');

  const trimBox = h('div.row', { style: { gap: '4px', marginTop: '6px' } },
    btn('−10', { size: 'sm', onClick: () => trim(id, -10) }),
    btn('−1', { size: 'sm', onClick: () => trim(id, -1) }),
    btn('+1', { size: 'sm', onClick: () => trim(id, 1) }),
    btn('+10', { size: 'sm', onClick: () => trim(id, 10) }));

  box.append(
    h('div', {},
      h('div.subhead', '标定'),
      h('div.kv', {}, h('span.kv-k', '0 位偏移'), h('span.kv-v.mono', offset === undefined || offset === null ? DASH : String(offset))),
      h('div.kv', {}, h('span.kv-k', '方向'), h('span.kv-v', direction === undefined || direction === null ? DASH : (Number(direction) < 0 ? '反向（−1）' : '正向（+1）'))),
      h('div.kv', {}, h('span.kv-k', '限位'), h('span.kv-v.mono', `${min ?? DASH} – ${max ?? DASH}`)),
      trimBox),
    h('div', {},
      h('div.subhead', 'P / D'),
      h('div.kv', {}, h('span.kv-k', '位置 P'), h('span.kv-v.mono', p == null ? DASH : fmt.int(p))),
      h('div.kv', {}, h('span.kv-k', '位置 D'), h('span.kv-v.mono', d == null ? DASH : fmt.int(d))),
      h('div.hint-line', { style: { marginTop: '6px' } },
        p == null && d == null ? '后端没上报这项，单颗读取后才有。' : '参数只读展示，改动请走寄存器编辑。')),
    h('div.stack-8', {},
      btn('编辑寄存器', { kind: 'outline', icon: 'settings', onClick: () => openRegs(ctx, id) }),
      btn(session(ctx) ? '单颗读取' : '接管后读取', {
        size: 'sm',
        disabled: !session(ctx),
        onClick: () => readOne(ctx, id),
      })));

  if (session(ctx) && !readCache.has(id)) readOne(ctx, id);
  return box;
}

function updateDetail(box, id) {
  const d = get(pageCtx.state(), 'servos.draft', {}) || {};
  const nodes = box.querySelectorAll('.kv-v');
  if (nodes.length >= 3) {
    const offset = get(d, `items.${id}.offset`);
    const direction = get(d, `items.${id}.direction`);
    const min = get(d, `items.${id}.min`);
    const max = get(d, `items.${id}.max`);
    if (offset !== undefined) nodes[0].textContent = String(offset);
    if (direction !== undefined) nodes[1].textContent = Number(direction) < 0 ? '反向（−1）' : '正向（+1）';
    if (min !== undefined || max !== undefined) nodes[2].textContent = `${min ?? DASH} – ${max ?? DASH}`;
  }
}

async function readOne(ctx, id) {
  if (!session(ctx)) return;
  try {
    const res = await ctx.cmd('servo.read', { id }, { timeout: 6000 });
    const rec = res?.servo || res || {};
    readCache.set(id, rec);
    if (expanded === id) {
      const old = el.board.querySelector('.srv-detail');
      if (old) old.replaceWith(detailRow(ctx, id));
    }
  } catch (err) {
    toastError(err);
  }
}

async function readAll() {
  const ctx = pageCtx;
  if (!session(ctx)) { toast('先接管总线', 'warn'); return; }
  const ids = GROUPS.flatMap((g) => g.ids);
  let ok = 0;
  for (const id of ids) {
    try {
      const res = await ctx.cmd('servo.read', { id }, { timeout: 4000 });
      readCache.set(id, res?.servo || res || {});
      ok += 1;
    } catch { /* 单颗失败不打断 */ }
  }
  toast(`读到 ${ok}/${ids.length} 颗`, ok === ids.length ? 'ok' : 'warn');
}

async function trim(id, delta) {
  try {
    const res = await pageCtx.run('servo.trim', { id, delta });
    toast(`${id} 号 0 位偏移 → ${res?.offset ?? '—'}`, 'ok', 2200);
    readCache.delete(id);
  } catch { /* 已提示 */ }
}

/* ---------------------------------------------------------------- 寄存器弹窗 */
async function openRegs(ctx, id) {
  if (!session(ctx)) { toast('先接管总线才能写寄存器', 'warn'); return; }
  const regSelect = h('select.select', { 'aria-label': '寄存器' },
    ...REGS.map(([num, name]) => h('option', { value: String(num) }, `${num} · ${name}`)),
    h('option', { value: 'custom' }, '其它（手填寄存器号）'));
  const regCustom = h('input.input.mono', { type: 'number', min: '0', max: '255', placeholder: '寄存器号', value: '' });
  regCustom.hidden = true;
  const valueInput = h('input.input.mono', { type: 'number', min: '0', max: '65535', placeholder: '值（0–65535）' });
  const eeprom = h('input', { type: 'checkbox', id: 'eeprom' });
  const dangerBox = h('div.danger-text');
  dangerBox.hidden = true;

  const currentReg = () => (regSelect.value === 'custom' ? Number(regCustom.value) : Number(regSelect.value));
  const syncDanger = () => {
    const reg = currentReg();
    const text = DANGER[reg];
    dangerBox.hidden = !text;
    if (text) dangerBox.textContent = `寄存器 ${reg} 是危险寄存器：${text}`;
  };
  regSelect.addEventListener('change', () => {
    regCustom.hidden = regSelect.value !== 'custom';
    syncDanger();
  });
  regCustom.addEventListener('input', syncDanger);
  syncDanger();

  const body = h('div.stack', {},
    h('div.reg-form', {},
      h('label.field.full', {}, h('span.field-label', '寄存器'), regSelect, regCustom),
      h('label.field.full', {}, h('span.field-label', '新值'), valueInput),
      h('label.row.full', { style: { gap: '8px' } }, eeprom,
        h('span', {}, '写 EEPROM（掉电保存）—— 改错会一直错，直到再用寄存器改回来'))),
    dangerBox,
    h('div.note', {}, icon('info', 15),
      h('div', {}, '改的是真硬件。0 位与方向建议用上面的「0 位偏移」按钮，别直接写寄存器。')));

  const ok = await ctx.confirm({
    title: `改 ${id} 号舵机寄存器`,
    sub: '写之前确认 ID 和寄存器号都对',
    body,
    okText: '写入',
    danger: true,
  });
  if (!ok) return;

  const reg = currentReg();
  const value = Number(valueInput.value);
  if (!Number.isFinite(reg) || reg < 0 || reg > 255) { toast('寄存器号填 0–255', 'warn'); return; }
  if (!Number.isFinite(value) || valueInput.value === '') { toast('值不能空', 'warn'); return; }

  if (DANGER[reg]) {
    const sure = await ctx.confirm({
      title: '危险寄存器，二次确认',
      body: h('div.stack-8', {},
        h('div.danger-text', {}, `寄存器 ${reg}：${DANGER[reg]}`),
        h('div', {}, `确认把 ${id} 号舵机的寄存器 ${reg} 写成 ${value}？`)),
      okText: '我知道后果，写入',
      danger: true,
    });
    if (!sure) return;
  }

  try {
    const args = { id, reg, value, eeprom: eeprom.checked };
    if (DANGER[reg]) args.confirm = true;
    await ctx.run('servo.write', args);
    readCache.delete(id);
    toast(`${id} 号寄存器 ${reg} ← ${value}`, 'ok');
    if (expanded === id) {
      const old = el.board.querySelector('.srv-detail');
      if (old) old.replaceWith(detailRow(ctx, id));
    }
  } catch { /* 已提示 */ }
}

/* ---------------------------------------------------------------- 联动 */
function focusJoint(id, toggle = true) {
  expanded = toggle && expanded === id ? null : id;
  for (const row of el.board.querySelectorAll('.srv-row')) {
    row.setAttribute('aria-expanded', String(Number(row.dataset.id) === expanded));
  }
  buildTable(pageCtx, get(pageCtx.state(), 'servos.items', []) || []);
  duck?.setHighlight(expanded);
  if (expanded != null) {
    const row = el.board.querySelector(`.srv-row[data-id="${expanded}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
