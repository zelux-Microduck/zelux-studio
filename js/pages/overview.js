/* 总控：深空舞台 + 上手清单 + 仪表带 + 快捷遥控。
   所有结论都从真实 state 推，没有数据就写"待做/没有数据"，不编状态。 */

import { h, icon, btn, chip, card, fmt, get, DASH } from '../ui.js';
import { createDuck } from '../duck2d.js';
import { link } from '../link.js';

let duck = null;
let el = {};
let unsub = null;

const POSTURE_COPY = {
  absent: { say: '还没连上主控', hint: '检查电源和总线，再刷新这一页', next: null },
  starting: { say: '主控在启动', hint: '等它自检完，先别动鸭子', next: null },
  limp: { say: '现在是卸力状态', hint: '扶稳它，再让它站起来', next: { label: '站起来', act: 'stand' } },
  homing: { say: '正在校 0 位', hint: '别碰它，几秒就好', next: null },
  holding: { say: '站着，随时可以走', hint: '推手柄摇杆，或点下面「开始走」', next: { label: '开始走', act: 'walk' } },
  walking: { say: '正在走', hint: '摇杆回中就会停，Start 是急停', next: { label: '停下来', act: 'stop' } },
  sitting: { say: '坐着', hint: '点「站起来」回到站姿', next: { label: '站起来', act: 'stand' } },
  servo_session: { say: '正在调舵机', hint: '主程序停着，会话会一直保持', next: { label: '回舵机页', act: 'servos' } },
};

export function page(ctx) {
  const stageCanvas = h('canvas', { 'aria-label': 'MicroDuck 当前三维姿态模型，可拖动旋转查看' });

  const canvasBox = h('div.stage-canvas-box', {}, stageCanvas);
  const stateText = h('div.stage-state', { class: 'live-num' }, DASH);
  const hintText = h('div.stage-hint', {}, '等第一条状态…');
  const nextBtn = btn('去舵机页', { kind: 'primary', onClick: () => ctx.go('/servos') });
  const stageChips = h('div.row', {});
  const netText = h('div.stage-net', {});
  const viewSeg = h('div.seg', { role: 'group', 'aria-label': '视图' },
    h('button', { type: 'button', 'aria-pressed': 'true', 'data-v': 'side' }, '3/4 视角'),
    h('button', { type: 'button', 'aria-pressed': 'false', 'data-v': 'front' }, '正视'));
  const resetViewBtn = btn('回正', { kind: 'ghost', size: 'sm', onClick: () => duck?.resetView() });

  const stage = h('section.panel-stage.stage.on-stage', { 'aria-label': 'MicroDuck 姿态舞台' },
    h('div.stage-top', {}, h('div.stage-eyebrow', 'Stage · 姿态'), h('div.row', {}, stageChips, viewSeg, resetViewBtn)),
    canvasBox,
    h('div.stage-bottom', {},
      h('div.grow', {}, stateText, hintText),
      h('div.stack-8', { style: { alignItems: 'flex-end' } }, nextBtn, netText)));

  viewSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    for (const x of viewSeg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    duck?.setMode(b.dataset.v);
  });

  /* ---------------- 上手清单 ---------------- */
  const checkGrid = h('div.checklist');
  const commitBar = h('div.commit-bar');
  commitBar.hidden = true;
  const commitBtn = btn('写入主控', { kind: 'primary', onClick: () => openCommit(ctx) });
  commitBar.append(icon('check', 15), h('span.grow', {}, '四项都齐了：预览要写的内容，再一次写进主控。'), commitBtn);

  const checkCard = card({ title: '上手清单', sub: '按顺序做，前三项完成就能一次写入' }, checkGrid, commitBar);

  /* ---------------- 仪表带 ---------------- */
  const gauges = h('div.gauges');
  const G = {
    cpu: gauge('主控温度', 'cpu'),
    bat: gauge('电量', 'battery'),
    tof: gauge('ToF 最近距离', 'tof'),
    fan: gauge('风扇转速', 'fan'),
    ai: gauge('AI 时延', 'ai'),
    train: gauge('训练槽位', 'train'),
  };
  Object.values(G).forEach((g) => gauges.append(g.el));

  /* ---------------- 快捷遥控 ---------------- */
  const remote = h('div.remote', {},
    quickBtn('站起来', '站姿 · stand', 'arrowUp', () => slot(ctx, 'stand')),
    quickBtn('开始走', '走 · walk', 'play', () => slot(ctx, 'walk')),
    quickBtn('坐下', '坐 · sitstand', 'chevronDown', () => slot(ctx, 'sitstand')),
    quickBtn('卸力', '急停 · 空格', 'bolt', () => relax(ctx), 'btn-danger'));

  const remoteCard = card({ title: '快捷遥控', sub: '和手柄、空格键走同一条命令通道' }, remote,
    h('div.hint-line', { style: { marginTop: '10px' } },
      '「卸力」就是急停，四路同源：顶栏红键、空格、手柄 Start、这里。避障不会解除急停。'));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '总控'),
        h('div.page-desc', '一眼看清它现在是什么状态、下一步该做什么。')),
      h('div.page-head-actions', {},
        btn('舵机页', { icon: 'servo', onClick: () => ctx.go('/servos') }),
        btn('去 AI', { icon: 'ai', onClick: () => ctx.go('/ai') }))),
    stage,
    checkCard,
    gauges,
    remoteCard);

  el = {
    stageCanvas, stateText, hintText, nextBtn, stageChips, netText,
    checkGrid, commitBar, commitBtn, gauges, pageEl,
  };

  duck = createDuck(stageCanvas, { mode: 'side', pageScroll: true, centerX: 0.58, fill: 0.82 });
  duck.setPose(null, true);
  return pageEl;
}

export function mount(ctx) {
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
  window.addEventListener('resize', onResize);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  window.removeEventListener('resize', onResize);
  duck?.destroy();
  duck = null;
  el = {};
}

function onResize() {
  duck?.redraw();
}

/* ---------------------------------------------------------------- 绘制 */
function paint(ctx) {
  const st = ctx.state();
  if (!el.stateText) return;

  // 姿态画布：保留后端按 ID 上报的完整 15 关节数组。
  const items = get(st, 'servos.items', []);
  duck?.setState(st);
  if (Array.isArray(items) && items.length) {
    el.hintText.dataset.poseSource = 'live';
  } else {
    el.hintText.dataset.poseSource = get(st, 'servos.items_omitted', false) ? 'omitted' : 'none';
  }

  // 状态一句话
  const estop = get(st, 'estop.state');
  const posture = get(st, 'posture');
  const copy = POSTURE_COPY[posture] || { say: '状态未知', hint: '等设备上报', next: null };
  if (estop === 'confirmed') {
    el.stateText.textContent = '已急停：全部舵机卸力';
    el.hintText.textContent = '扶稳鸭子；重新加力要去舵机页接管总线。';
    setNext(el.nextBtn, { label: '去舵机页', act: 'servos' }, ctx);
  } else if (estop === 'unavailable') {
    el.stateText.textContent = '急停没生效';
    el.hintText.textContent = get(st, 'estop.why', '总线没响应，直接断电') || '总线没响应，直接断电';
    setNext(el.nextBtn, null, ctx);
  } else {
    // "主控没在跑"在模拟模式下是正常的，不该让人以为接线坏了。
    const sim = link.hello?.caps?.sim;
    if (posture === 'absent' && sim) {
      el.stateText.textContent = '模拟模式：没有实时控制层';
      el.hintText.textContent = '页面与协议都是真的，机器人在主板上才动；接上主板这里会显示真实姿态';
      setNext(el.nextBtn, null, ctx);
    } else {
    el.stateText.textContent = copy.say;
    el.hintText.textContent = copy.hint;
    setNext(el.nextBtn, copy.next, ctx);
    }
  }

  // 舞台上的小徽章
  const modeText = st?.mode === 'motion' ? '运动模式' : st?.mode === 'commissioning' ? '标定模式' : DASH;
  setStageChips(ctx.state(), modeText);

  // 在线/延迟（右下角）
  const age = st && st.ts ? Math.max(0, Date.now() / 1000 - st.ts) : null;
  const lat = ctx.link.latency;
  el.netText.replaceChildren();
  const online = ctx.link.online;
  el.netText.append(
    h('span', { class: online ? 'ok' : 'bad' }, online ? '● 在线' : '○ 离线'),
    h('span', {}, lat == null ? '延迟 —' : `延迟 ${fmt.int(lat)} ms`),
    h('span', {}, age == null ? '10 Hz' : `数据 ${age < 1 ? '<1' : fmt.int(age)} s 前`),
  );

  // 清单
  paintChecklist(ctx, st);
  paintGauges(ctx, st);
}

function setNext(btnEl, next, ctx) {
  if (!next) {
    btnEl.hidden = true;
    return;
  }
  btnEl.hidden = false;
  btnEl.replaceChildren(h('span', {}, next.label));
  btnEl.onclick = () => {
    if (next.act === 'servos') { ctx.go('/servos'); return; }
    if (next.act === 'stop') { ctx.run('pad.op', { op: 'stop' }); return; }
    slot(ctx, next.act);
  };
}

function slot(ctx, name) {
  ctx.run('pad.op', { op: 'skill', name }).catch(() => {});
}

function relax(ctx) {
  ctx.run('relax', {}).catch(() => {});
}

function quickBtn(label, sub, iconName, onClick, kind = '') {
  const b = btn(null, { kind, class: 'remote-btn', onClick });
  b.replaceChildren(icon(iconName, 17), h('span', {}, label), h('small', {}, sub));
  return b;
}

function gauge(label, key) {
  const v = h('div.gv', {}, DASH);
  const s = h('div.gs', {}, '');
  const box = h('div.gauge', { dataset: { key } }, h('div.gl', label), v, s);
  return { el: box, v, s };
}

function setStageChips(st, modeText) {
  const items = [];
  items.push(chip(modeText, st?.mode === 'motion' ? 'ok' : 'warn'));
  const bat = get(st, 'battery.pct');
  if (bat !== undefined) items.push(chip(`电量 ${fmt.int(bat)}%`, bat <= 20 ? 'danger' : ''));
  const sess = st?.servo_session;
  if (sess) items.push(chip(`接管 ${sess.holding ?? sess.online ?? DASH} 颗`, 'warn'));
  el.stageChips.replaceChildren(...items);
}

/* ---------------------------------------------------------------- 清单 */
function paintChecklist(ctx, st) {
  const draft = get(st, 'servos.draft', {});
  const session = st?.servo_session;
  const dirty = Number(get(draft, 'dirty', 0)) || 0;
  const changed = get(draft, 'changed', []);

  const imu = st?.imu || {};
  const wizard = imu.wizard || {};
  const solved = wizard.result && wizard.result.ok;
  const imuDone = Boolean(imu.calibrated);
  const imuSteps = (wizard.steps || []).filter((s) => s.done).length;

  const pad = st?.pad || {};
  const padDone = Boolean(pad.connected || pad.virtual);
  const bound = Object.keys(pad.bindings || {}).length;

  const mode = st?.mode;
  const written = mode === 'motion';

  const servosDone = dirty > 0;
  const items = [
    {
      n: 1, title: '舵机 0 位',
      state: servosDone ? 'done' : session ? 'todo' : 'todo',
      text: servosDone
        ? `已调 ${dirty || changed.length || 0} 颗，还在草稿里`
        : session
          ? `已接管 ${session.online ?? 15} 颗，还没动 0 位`
          : '先接管总线，再调 0 位和方向',
      go: '/servos',
    },
    {
      n: 2, title: 'IMU 方向',
      state: imuDone ? 'done' : solved ? 'done' : wizard.running ? 'todo' : 'todo',
      text: imuDone
        ? `已校准，残差 ${fmt.deg(imu.residual_deg ?? get(st, 'imu.wizard.result.residual_deg'))}`
        : solved
          ? '已解算通过，还没写入文件'
          : wizard.running
            ? `采集第 ${imuSteps + 1}/5 步`
            : imu.ok === false
              ? '读不到 IMU，先检查接线'
              : '五步采集：平放 + 前后左右各倾一次',
      go: '/imu',
    },
    {
      n: 3, title: '手柄',
      state: padDone ? 'done' : 'todo',
      text: pad.connected
        ? `${pad.name || '手柄'}已连上，绑了 ${bound} 个键`
        : pad.virtual
          ? '网页虚拟手柄正在使用，实体手柄还没连'
          : '插上 USB 手柄，或用网页虚拟手柄',
      go: '/pad',
    },
    {
      n: 4, title: '写入主控',
      state: written ? 'done' : 'todo',
      text: written ? '已写入并切到运动模式' : '前三项完成后，一次写入',
      go: '/settings',
    },
  ];

  el.checkGrid.replaceChildren(...items.map((it) => h('button', {
    class: 'check-item',
    type: 'button',
    dataset: { state: it.state },
    onclick: () => ctx.go(it.go),
  },
  h('div.top', {}, h('span.idx', it.state === 'done' ? '✓' : String(it.n)), h('span.ct', it.title)),
  h('span.cs', it.text))));

  const ready = servosDone && (imuDone || solved) && padDone && !written;
  el.commitBar.hidden = !ready;
  el.commitBtn.disabled = !ready || !ctx.link.online;
}

/* ---------------------------------------------------------------- 仪表 */
function paintGauges(ctx, st) {
  const temp = get(st, 'cpu.temp');
  const q = (key) => el.gauges?.querySelector(`[data-key="${key}"]`) || null;

  writeGauge(q('cpu'), temp === undefined ? DASH : fmt.f1(temp), '℃',
    get(st, 'cpu.load') === undefined ? '负载 —' : `负载 ${fmt.f2(get(st, 'cpu.load'))}`,
    temp !== undefined && temp >= 80 ? 'bad' : temp !== undefined && temp >= 70 ? 'warn' : '');

  const pct = get(st, 'battery.pct');
  const volt = get(st, 'battery.v');
  writeGauge(q('battery'), pct === undefined ? DASH : fmt.int(pct), '%',
    volt === undefined ? '电压 —' : `${fmt.f2(volt)} V · 误差约 ±15%`,
    pct !== undefined && pct <= 10 ? 'bad' : pct !== undefined && pct <= 20 ? 'warn' : '');

  const near = get(st, 'tof.nearest_mm');
  const action = get(st, 'tof.avoid.action');
  const actionCN = { clear: '直行', slow: '减速', turn: '绕行', stop: '停车' }[action] || '—';
  writeGauge(q('tof'), near === undefined ? DASH : fmt.int(near), 'mm',
    `避障 ${actionCN}${get(st, 'tof.avoid.on') ? '' : '（未开）'}`,
    action === 'stop' ? 'bad' : action === 'slow' ? 'warn' : '');

  const fans = get(st, 'fan.items', []) || [];
  const rpms = fans.map((f) => f.rpm).filter((x) => typeof x === 'number' && x > 0);
  const fanMode = get(st, 'fan.mode') === 'manual' ? '手动' : '自动';
  writeGauge(q('fan'), rpms.length ? fmt.int(Math.max(...rpms)) : '—', rpms.length ? 'RPM' : '',
    `风扇 ${fmt.pct(get(st, 'fan.pct'))} · ${fanMode}`, '');

  const aiMs = get(st, 'ai.latency_ms');
  writeGauge(q('ai'), aiMs === undefined ? DASH : fmt.int(aiMs), 'ms',
    aiMs !== undefined && aiMs < 2000 ? '< 2 s 达标' : get(st, 'ai.ready') ? '超过 2 s' : '没配模型',
    aiMs === undefined ? '' : aiMs < 2000 ? '' : 'warn');

  const slots = get(st, 'train.slots', []) || [];
  const loaded = slots.filter((s) => s.model).length;
  const running = slots.find((s) => s.running);
  writeGauge(q('train'), `${loaded}`, `/ ${slots.length || 6}`,
    running ? `运行中：${slotCN(running.slot)}` : '没有运行中的策略',
    get(st, 'train.recording') ? 'warn' : '');
}

function writeGauge(box, value, unit, sub, kind) {
  if (!box) return;
  const v = box.querySelector('.gv');
  const s = box.querySelector('.gs');
  v.replaceChildren(h('span.live-num', String(value)), unit ? h('span.unit', unit) : null);
  s.textContent = sub;
  box.classList.toggle('is-warn', kind === 'warn');
  box.classList.toggle('is-bad', kind === 'bad');
}

function slotCN(slot) {
  return {
    walk: '走路', sitstand: '坐下站起', ground_pick: '捡东西',
    kick_left: '左踢', kick_right: '右踢', roulade: '前滚翻', stand: '站好',
  }[slot] || slot || DASH;
}

/* ---------------------------------------------------------------- 写入主控 */
async function openCommit(ctx) {
  let dry;
  try {
    dry = await ctx.run('servo.commit_draft', { dry_run: true });
  } catch {
    return;
  }
  const diff = dry?.diff || {};
  const rows = Object.entries(diff).map(([sid, d]) => {
    const before = d.before || {};
    const after = d.after || {};
    const parts = [];
    for (const [k, label] of [['offset', '0 位'], ['direction', '方向'], ['min', '下限'], ['max', '上限']]) {
      if (after[k] !== undefined && after[k] !== before[k]) {
        parts.push(`${label} ${before[k] ?? '—'} → ${after[k]}`);
      }
    }
    return h('tr', {}, h('td.mono', sid), h('td', parts.join('；') || '（无差异）'));
  });

  const st = ctx.state() || {};
  const imuPending = Boolean(get(st, 'imu.wizard.result.ok')) && !get(st, 'imu.calibrated');

  const body = h('div.stack', {},
    h('div.note.note-warn', {}, icon('alert', 15),
      h('div', {}, '写入后会落到舵机 EEPROM 和 state_dir 里的标定文件。写完自动切运动模式，主程序接管。')),
    rows.length
      ? h('table.table', {},
        h('thead', {}, h('tr', {}, h('th', '舵机 ID'), h('th', '将要改成'))),
        h('tbody', {}, ...rows))
      : h('div', {}, `没有待写入的舵机差异（后端报告 ${dry?.changed ?? 0} 处改动）。`),
    imuPending
      ? h('div.note.note-ok', {}, icon('info', 15), h('div', {}, 'IMU 标定也会一起写入（解算已通过、还没落盘）。'))
      : null);

  const ok = await ctx.confirm({
    title: '写入主控',
    sub: `共 ${dry?.changed ?? rows.length} 处改动`,
    body,
    okText: '确认写入',
    wide: true,
  });
  if (!ok) return;

  try {
    const res = await ctx.run('servo.commit_draft', {});
    if (imuPending) {
      try {
        await link.cmd('imu.op', { op: 'commit' });
      } catch (err) {
        ctx.toast(`舵机已写入，但 IMU 标定没写进去：${err.message}`, 'warn', 6000);
      }
    }
    ctx.toast(`已写入 ${res?.items ?? '—'} 颗舵机，切换到运动模式`, 'ok', 4200);
  } catch {
    /* ctx.run 已经 toast 过服务端原文 */
  }
}
