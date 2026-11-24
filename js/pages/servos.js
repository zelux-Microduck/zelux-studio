/* 舵机页：接管会话 + 15 颗分组表 + 零位微调 + 官方姿势 + 寄存器编辑。
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
  10: '右髋偏航', 11: '右髋横滚', 12: '右髋俯仰', 13: '右膝', 14: '右踝',
  20: '左髋偏航', 21: '左髋横滚', 22: '左髋俯仰', 23: '左膝', 24: '左踝',
  30: '颈部俯仰', 31: '头部俯仰', 32: '头部偏航', 33: '头部横滚', 34: '嘴巴',
};

const REGS = [
  [5, 'ID'], [6, '波特率'], [8, '应答级别'], [9, '最小限位'], [11, '最大限位'],
  [16, '最大扭矩'], [18, '相位'], [19, '卸载条件'], [21, '位置环 P'],
  [22, '位置环 D'], [23, '位置环 I'], [24, '最小启动扭矩'],
  [26, '正向不灵敏区'], [27, '负向不灵敏区'],
  [31, '零位偏移'], [33, '运行模式'], [40, '扭矩开关'], [41, '加速度'],
  [42, '目标位置'], [46, '运行速度'], [48, '转矩限制'], [50, '运行位置 P'], [51, '运行位置 D'],
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
  { value: '', label: '选择官方姿势…' },
  { value: 'zero', label: '零位（全部 2048）' },
  { value: 'stand', label: '站立姿势' },
  { value: 'sit', label: '坐下姿势' },
  { value: 'fold', label: '折叠姿势' },
];

let duck = null;
let unsub = null;
let pageCtx = null;
let expanded = null;
let readCache = new Map();
let el = {};
let lastItemsKey = '';
const sliderLastSent = new Map();
const sliderQueue = new Map();
let sliderGeneration = 0;
const sliderDragging = new Set();

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

  const centerAllBtn = btn('一键中位', { kind: 'primary', onClick: () => centerServos(ctx, GROUPS.flatMap((g) => g.ids)) });
  const centerUndoBtn = btn('撤销中位', { icon: 'refresh', onClick: () => undoCenter(ctx) });
  const actCard = card({ title: '标定动作', sub: '都需要先接管总线' },
    h('div.stack-8', {},
      h('div.row.wrap', {}, poseSelect,
        centerAllBtn, centerUndoBtn,
        btn('撤销微调', { icon: 'refresh', onClick: () => ctx.run('servo.undo', {}).then(() => toast('已撤销微调', 'ok')).catch(() => {}) })),
      h('div.divider'),
      h('div.row.wrap', {},
        btn('全部保持', { onClick: () => torque(true) }),
        btn('全部松开', { kind: 'warn', onClick: () => torque(false) })),
      h('div.hint-line', {}, '「松开」会卸力，鸭子会软下来——扶一下。急停请按顶栏红键。')));

  const board = h('div.srv-board');
  const scroll = h('div.srv-scroll', {}, board);

  const takeover = h('div.takeover');
  const directionApplyBtn = btn('应用软件方向', { disabled: !ctx.link?.online, onClick: () => applySavedDirections(ctx) });
  const header = h('div.row-between', {},
    h('div', {},
      h('h1.page-title', '舵机'),
      h('div.page-desc', '15 颗 · 右腿 10–14 / 左腿 20–24 / 头颈 30–34。点行展开详情，点左边关节也能展开。')),
    h('div.page-head-actions', {},
      directionApplyBtn,
      btn('读取全部', { icon: 'refresh', onClick: () => readAll() }),
      btn('回总控', { onClick: () => ctx.go('/') })));

  const pageEl = h('div.page', {}, header, takeover,
    h('div.srv-layout', {},
      h('div.stack', {},
        card({ title: '姿态', sub: '参考站 CAD 三维模型 · 15 颗舵机角实时驱动 · 拖动旋转', tight: true },
          h('div.srv-visual', {}, h('div.panel-stage.on-stage', { style: { padding: '8px' } }, canvas),
            h('div.row-between', { style: { marginTop: '8px' } }, viewSeg,
              h('span.hint-line', {}, '点关节高亮')),
            h('div.srv-hint', {}, '使用 MicroDuck CAD 模型实时显示 15 个关节。点模型可定位对应舵机；优先使用主控实时姿态；维护反馈按 robotd 提供的逐关节方向换算，方向缺失会明确标为示意。'))),
        actCard),
      card({ title: '舵机控制', sub: '每颗独立设置：目标位置、保持、中位、软件方向；方向保存后点页顶应用' }, scroll,
        h('div.hint-line', { style: { marginTop: '8px' } },
          '先打开该舵机的“保持”开关，再拖动位置滑块；“中位”会把当前物理位置写成 2048，请先扶稳机构。'))));

  el = { canvas, viewSeg, board, takeover, actCard, poseSelect, scroll, centerAllBtn, centerUndoBtn, directionApplyBtn };
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
  sliderGeneration += 1;
  sliderQueue.clear();
  sliderLastSent.clear();
  sliderDragging.clear();
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

  paintTakeover(ctx, sess, online, draft);

  // 姿态
  duck?.setState(st);
  duck?.setHighlight(expanded);

  // 表：只在数据形状变了（在线数/id 列表）时重建，其余只改数值
  const key = `${items.map((item) => item.id).join(",")}|${sess ? 1 : 0}`;
  if (key !== lastItemsKey) {
    lastItemsKey = key;
    buildTable(ctx, items);
  }
  updateRows(items, draft, sess, st.servos?.capabilities || {});

  el.poseSelect.disabled = !sess;
  el.centerAllBtn.disabled = !sess || !st.servos?.capabilities?.center;
  el.centerUndoBtn.disabled = !sess || !st.servos?.capabilities?.center;
  el.directionApplyBtn.disabled = !online;
}

function paintTakeover(ctx, sess, online, draft) {
  const active = !!sess;
  // Telemetry must not replace the hovered/focused action button.
  if (!el.takeoverAction || el.takeoverActive !== active) {
    el.takeoverActive = active;
    el.takeoverText = h('span.grow');
    el.takeoverAction = active
      ? btn('交还主程序', { size: 'sm', onClick: () => release(ctx) })
      : btn('开始调舵机', { kind: 'primary', size: 'sm', onClick: () => take(ctx) });
    el.takeover.className = active ? 'takeover is-on' : 'takeover';
    el.takeover.replaceChildren(icon(active ? 'check' : 'alert', 15), el.takeoverText, el.takeoverAction);
  }
  const text = active
    ? `已接管总线 · ${sess.online ?? '—'}/15 在线 · ${sess.holding ?? '—'} 颗保持`
      + (sess.took_ms != null ? ` · ${sess.took_ms} ms` : '')
      + (draft.dirty ? ` · 草稿 ${draft.dirty} 处改动待写入` : '')
    : online
      ? '只读：还没接管总线，改不了任何东西。维护期间普通运动指令被拒绝，robotd 继续独占总线。'
      : '连接断了：接管要先连上设备。';
  if (el.takeoverText.textContent !== text) el.takeoverText.textContent = text;
  el.takeoverAction.disabled = !online;
}

async function take(ctx) {
  if (!window.confirm("开始舵机维护前，请固定支撑机体，确保腿部与舵机转动区域无人接触。\n进入不会自动归位或改变扭矩；后续调节可能引起关节运动。\n确认已固定支撑并开始维护？")) return;
  try {
    const res = await ctx.run('servo.bus', { op: 'take', supported: true }, { timeout: 15000 });
    toast(`已接管：${res?.online ?? '—'}/15 在线${res?.missing?.length ? `，缺 ${res.missing.join('、')}` : ''}`, 'ok', 4200);
  } catch { /* 已提示 */ }
}

async function release(ctx) {
  try {
    await ctx.run('servo.bus', { op: 'release' });
    toast('已退出维护；不会自动恢复行走，扭矩保持退出前状态', 'ok');
  } catch { /* 已提示 */ }
}

function torque(on) {
  pageCtx.run('servo.torque', { on }).then(() => toast(on ? '全部加力' : '全部卸力', on ? 'ok' : 'warn')).catch(() => {});
}

function pose(name) {
  pageCtx.run('servo.pose', { name }).then(() => toast(`已到 ${name} 姿势`, 'ok')).catch(() => {});
}

async function centerServos(ctx, ids) {
  if (!session(ctx)) { toast('先接管总线', 'warn'); return; }
  try {
    const plan = await ctx.cmd('servo.center_plan', { ids }, { timeout: 20000 });
    const rows = plan?.rows || [];
    const large = rows.filter((r) => Math.abs(Number(r.diff_deg)) > Number(plan.warning_deg || 30));
    const summary = rows.map((r) => `${r.id}号 ${r.pos} → 2048（${r.diff_deg > 0 ? '+' : ''}${r.diff_deg}°）`).join('\n');
    const ok = await ctx.confirm({
      title: `中位校准 ${rows.length} 颗舵机`,
      message: `请先扶稳鸭子并摆成官方零位：腿伸直、头摆正、嘴闭合。\n\n${summary}${large.length ? `\n\n注意：${large.length} 颗偏差超过 ${plan.warning_deg}°。` : ''}\n\n必须先固定支撑机体并点击卸力，再执行校准。把当前位置写成 2048，保存可撤销备份；完成后保持卸力，不会自动加力。`,
      okText: `确认校准 ${rows.length} 颗`,
      danger: true,
    });
    if (!ok) return;
    const res = await ctx.run('servo.center', { ids, confirm: true }, { timeout: 60000 });
    readCache = new Map();
    toast(`中位校准完成：${res?.centered?.length || rows.length} 颗`, 'ok', 5000);
  } catch { /* 已提示 */ }
}

async function undoCenter(ctx) {
  if (!session(ctx)) { toast('先接管总线', 'warn'); return; }
  const ok = await ctx.confirm({
    title: '撤销上一次中位校准',
    message: '将把上一次校准前保存的舵机偏移写回 EEPROM。请扶稳鸭子。',
    okText: '恢复备份',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await ctx.run('servo.center_undo', { confirm: true }, { timeout: 60000 });
    readCache = new Map();
    toast(`已恢复 ${res?.restored?.length || 0} 颗舵机，原备份已归档`, 'ok');
  } catch { /* 已提示 */ }
}

/* ---------------------------------------------------------------- 舵机控制卡 */
function buildTable(ctx, items) {
  const byId = new Map(items.map((it) => [Number(it.id), it]));
  el.board.replaceChildren();
  for (const g of GROUPS) {
    const cards = h('div.srv-card-grid');
    for (const id of g.ids) cards.append(servoCard(ctx, id, byId.get(id) || null));
    el.board.append(h('section.srv-group-card', {},
      h('div.srv-group-title', {}, h('span', g.name), h('span.ids', `${g.ids.join(' · ')} 号舵机`)), cards));
  }
}

function servoCard(ctx, id, it) {
  const card = h('article.srv-card', { dataset: { id: String(id) } },
    h('div.srv-card-top', {},
      h('div', {},
        h('div.srv-card-name', {}, h('span.srv-card-id', `#${id}`), h('span', NAME_CN[id] || '—')),
        h('div.srv-card-key', {}, JOINTS.find((j) => j.id === id)?.key || '')),
      h('div.srv-card-reading', {},
        h('span.label', '当前位置'), h('span.pos', it ? fmt.int(it.pos) : DASH))),
    servoSlider(id, it),
    h('div.srv-card-bottom', {},
      cell('temp', it ? `${fmt.f1(it.temp)}°C` : DASH, '温度'),
      h('span.torque-cell', { 'data-label': get(ctx.state(), 'servos.source') === 'robotd' ? '调试保持' : '保持' }, torqueSwitch(id, it)),
      h('span.center-cell', { 'data-label': '中位校准' }, btn('设中位', {
        size: 'sm', disabled: !session(ctx),
        onClick: (e) => { e?.stopPropagation?.(); centerServos(ctx, [id]); },
      })),
      h('span.direction-cell', { 'data-label': '软件方向' }, btn('配置方向', {
        size: 'sm', disabled: !ctx.link?.online,
        onClick: (e) => { e?.stopPropagation?.(); configureDirection(ctx, id); },
      }))));
  card.addEventListener('click', () => focusJoint(id, false));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusJoint(id, false); } });
  card.tabIndex = 0;
  if (expanded === id) card.append(detailRow(ctx, id));
  return card;
}

function cell(name, value, label = '') {
  return h('span.cell', { class: name, 'data-label': label }, value);
}

const directionJobs = new Set();
let directionRestarting = false;

async function configureDirection(ctx, id) {
  if (directionJobs.has(id)) return;
  directionJobs.add(id);
  try {
    const status = await ctx.cmd('servo.direction', { action: 'status' }, { timeout: 8000 });
    const index = status?.ids?.indexOf(id);
    if (status?.schema !== 'zelux.servo-directions/v1' || index == null || index < 0
        || ![-1, 1].includes(status.saved?.[index]) || ![-1, 1].includes(status.runtime?.[index])) {
      toast('robotd 未提供完整的软件方向配置，请更新配套版本', 'warn'); return;
    }
    const label = value => value === -1 ? '反向（−1）' : '正向（+1）';
    const direction = h('select', { 'aria-label': id + ' 号舵机软件方向' },
      h('option', { value: '1' }, '正向（+1）'), h('option', { value: '-1' }, '反向（−1）'));
    direction.value = String(status.saved[index]);
    const ok = await ctx.confirm({
      title: id + ' 号 · ' + (NAME_CN[id] || '') + '软件方向',
      body: h('div.stack-8', {},
        h('div', {}, '当前生效：' + label(status.runtime[index]) + '；已保存：' + label(status.saved[index])),
        h('label', {}, '软件方向 ', direction),
        h('div.note', {}, '统一影响 robotd 的关节反馈、控制换算与 Studio 三维显示。不会写舵机相位寄存器，也不改变中位。保存后需安全重启；不要仅为视觉效果随意修改腿部方向。'),
        h('div', {}, status.pending_restart ? '存在已保存但尚未生效的方向。关闭此窗口后，可点页顶“应用软件方向”。' : '方向配置已生效。')),
      okText: '保存方向', danger: true,
    });
    if (!ok) return;
    const result = await ctx.run('servo.direction', {
      action: 'save', id, direction: Number(direction.value), expected: status.saved, confirmed: true,
    }, { timeout: 8000 });
    toast(result.pending_restart ? '软件方向已保存，待安全重启 robotd；请点页顶“应用软件方向”' : '软件方向已保存并与运行配置一致', 'ok');
  } catch (error) { toastError(error); }
  finally { directionJobs.delete(id); }
}

async function applySavedDirections(ctx) {
  try {
    const status = await ctx.cmd('servo.direction', { action: 'status' }, { timeout: 8000 });
    if (status?.schema !== 'zelux.servo-directions/v1' || !status.pending_restart) {
      toast('没有待应用的软件方向配置；可在各舵机卡片点击“配置方向”', 'warn'); return;
    }
    await restartDirections(ctx, status.saved);
  } catch (error) { toastError(error); }
}

async function restartDirections(ctx, expected) {
  if (directionRestarting) return;
  directionRestarting = true;
  try {
    const ok = await ctx.confirm({
      title: '重启 robotd 应用软件方向',
      body: h('div', {}, '请固定支撑机器人并停止运动。将退出舵机维护（如有），然后请求安全重启 robotd。重启可能改变保持状态；启动后的控制和三维反馈将使用新方向。'),
      okText: '退出维护并请求重启', danger: true,
    });
    if (!ok) return;
    if (session(ctx)) await ctx.run('servo.bus', { op: 'release' });
    await ctx.run('servo.direction', { action: 'restart', expected, confirmed: true }, { timeout: 8000 });
    toast('已请求重启 robotd；等待连接恢复后重新打开“配置方向”核对生效状态', 'ok');
  } catch (error) { toastError(error); }
  finally { directionRestarting = false; }
}

function sendSliderGoal(id, value, force = false) {
  let job = sliderQueue.get(id);
  if (!job) {
    job = { pending: null, running: false, generation: sliderGeneration, ctx: pageCtx };
    sliderQueue.set(id, job);
  }
  job.pending = Number(value);
  if (job.running) return;
  job.running = true;
  const pump = async () => {
    while (job.pending != null && job.generation === sliderGeneration) {
      const delay = Math.max(0, 50 - (performance.now() - (sliderLastSent.get(id) || 0)));
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (job.generation !== sliderGeneration) break;
      const pos = job.pending;
      job.pending = null;
      sliderLastSent.set(id, performance.now());
      try { await job.ctx.run('servo.goal', { id, pos }, { timeout: 3000 }); }
      catch { job.pending = null; break; }
    }
    job.running = false;
  };
  void pump();
}

function servoSlider(id, it) {
  const torqueOn = it?.torque === true;
  const input = h('input.srv-slider', {
    type: 'range', min: '0', max: '4095', step: '1',
    value: String(it?.pos ?? 2048),
    disabled: !session(pageCtx) || !torqueOn,
    'aria-label': `${id} 号目标位置`,
    title: torqueOn ? '拖动控制目标位置；每 50 ms 最多发送一次' : '先打开这颗舵机的保持，再拖动',
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => { e.stopPropagation(); sliderDragging.add(id); });
  input.addEventListener('input', (e) => {
    e.stopPropagation();
    sliderDragging.add(id);
    sendSliderGoal(id, e.target.value, false);
    const card = e.target.closest('.srv-card');
    const pos = card?.querySelector('.pos');
    if (pos) pos.textContent = e.target.value;
    // 拖动时先按目标值预览 3D；后端 50 Hz 回读一到就会用真实位置校正。
    const pose = duck?.pose;
    const index = JOINTS.findIndex((joint) => joint.id === id);
    if (pose && index >= 0) {
      pose[index] = Number(e.target.value);
      duck.setPose(pose, true);
    }
  });
  const done = (e) => {
    e.stopPropagation();
    sendSliderGoal(id, e.target.value, true);
    window.setTimeout(() => sliderDragging.delete(id), 600);
  };
  input.addEventListener('change', done);
  return h('div.slider-cell', { 'data-label': '目标位置（拖动）' }, input);
}

function torqueSwitch(id, it) {
  const on = it?.torque === true;
  const sw = h('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': `${id} 号扭矩开关`,
    title: '通过主控维护会话显式切换扭矩；加力前会先建立当前位置保持目标。',
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

function updateRows(items, draft, sess, capabilities) {
  const byId = new Map(items.map((it) => [Number(it.id), it]));
  for (const card of el.board.querySelectorAll('.srv-card')) {
    const id = Number(card.dataset.id);
    const it = byId.get(id);
    const set = (cls, v) => {
      const n = card.querySelector(`.${cls}`);
      if (n && n.textContent !== String(v)) n.textContent = String(v);
    };
    if (!sliderDragging.has(id)) {
      set('pos', it ? fmt.int(it.pos) : DASH);
      const slider = card.querySelector('.srv-slider');
      if (slider && it?.pos != null) slider.value = String(it.pos);
    }
    const temp = it ? it.temp : null;
    set('temp', temp == null ? DASH : `${fmt.f1(temp)}°C`);
    card.querySelector('.temp')?.classList.toggle('hot', typeof temp === 'number' && temp >= 65);
    card.classList.toggle('is-off', !it || it.torque !== true);
    const sw = card.querySelector('.switch');
    if (sw) {
      if (it) sw.setAttribute('aria-checked', it.torque === true ? 'true' : 'false');
      sw.disabled = !sess;
    }
    const slider = card.querySelector('.srv-slider');
    if (slider) slider.disabled = !sess || !it || it.torque !== true || !capabilities.single_goal;
    const centerBtn = card.querySelector('.center-cell button');
    if (centerBtn) centerBtn.disabled = !sess || !capabilities.center;
    const directionBtn = card.querySelector('.direction-cell button');
    if (directionBtn) directionBtn.disabled = !pageCtx.link?.online;
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
  const direction = (get(ctx.state(), 'servos.items', []) || []).find(item => Number(item.id) === id)?.model_direction;
  const min = get(draft, `items.${id}.min`) ?? val('min');
  const max = get(draft, `items.${id}.max`) ?? val('max');
  const p = val('p_run') ?? val('p') ?? val('pos_p') ?? val('kp');
  const d = val('d_run') ?? val('d') ?? val('pos_d') ?? val('kd');
  const torqueLimit = val('torque_limit');
  const phase = val('phase');

  const trimBox = h('div.row', { style: { gap: '4px', marginTop: '6px' } },
    btn('−10', { size: 'sm', onClick: () => trim(id, -10) }),
    btn('−1', { size: 'sm', onClick: () => trim(id, -1) }),
    btn('+1', { size: 'sm', onClick: () => trim(id, 1) }),
    btn('+10', { size: 'sm', onClick: () => trim(id, 10) }));

  box.append(
    h('div', {},
      h('div.subhead', '零位标定'),
      h('div.kv', {}, h('span.kv-k', '零位偏移'), h('span.kv-v.mono', offset === undefined || offset === null ? DASH : String(offset))),
      h('div.kv', {}, h('span.kv-k', '软件方向'), h('span.kv-v', direction === undefined || direction === null ? DASH : (Number(direction) < 0 ? '反向（−1）' : '正向（+1）'))),
      h('div.kv', {}, h('span.kv-k', '相位寄存器'), h('span.kv-v.mono', phase == null ? DASH : `${phase}（保持固件速度位）`)),
      h('div.kv', {}, h('span.kv-k', '限位'), h('span.kv-v.mono', `${min ?? DASH} – ${max ?? DASH}`)),
      trimBox),
    h('div', {},
      h('div.subhead', '运行参数'),
      h('div.kv', {}, h('span.kv-k', '位置环 P'), h('span.kv-v.mono', p == null ? DASH : fmt.int(p))),
      h('div.kv', {}, h('span.kv-k', '位置环 D'), h('span.kv-v.mono', d == null ? DASH : fmt.int(d))),
      h('div.kv', {}, h('span.kv-k', '转矩限制'), h('span.kv-v.mono', torqueLimit == null ? DASH : fmt.int(torqueLimit))),
      h('div.hint-line', { style: { marginTop: '6px' } },
        p == null && d == null ? '单颗读取后显示运行参数。' : '安全上力时使用：P5 · D0 · 转矩限制 1000。')),
    h('div.stack-8', {},
      h('div.subhead', '高级操作'),
      btn('设为中位 2048', { kind: 'primary', disabled: !session(ctx), onClick: () => centerServos(ctx, [id]) }),
      btn('编辑寄存器', { kind: 'outline', icon: 'settings', onClick: () => openRegs(ctx, id) }),
      btn(session(ctx) ? '读取当前舵机' : '接管后读取', {
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
  if (nodes.length >= 4) {
    const offset = get(d, `items.${id}.offset`);
    const direction = (get(pageCtx.state(), 'servos.items', []) || []).find(item => Number(item.id) === id)?.model_direction;
    const min = get(d, `items.${id}.min`);
    const max = get(d, `items.${id}.max`);
    if (offset !== undefined) nodes[0].textContent = String(offset);
    nodes[1].textContent = [-1, 1].includes(direction) ? (direction < 0 ? '反向（−1）' : '正向（+1）') : DASH;
    if (min !== undefined || max !== undefined) nodes[3].textContent = `${min ?? DASH} – ${max ?? DASH}`;
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
    toast(`${id} 号零位偏移 → ${res?.offset ?? '—'}`, 'ok', 2200);
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
      h('div', {}, '这里修改的是真实硬件寄存器。零位请使用页面上的微调或“中位校准”，不要直接改偏移寄存器。')));

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
  buildTable(pageCtx, get(pageCtx.state(), 'servos.items', []) || []);
  duck?.setHighlight(expanded);
  if (expanded != null) {
    const card = el.board.querySelector(`.srv-card[data-id="${expanded}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
