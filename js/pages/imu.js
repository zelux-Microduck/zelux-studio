/* IMU 页：五步采集向导 + 实时姿态 + 校准前后对比。
   步骤顺序和平放/前后左右的角度判据都由后端给（state.imu.wizard），前端不重算规矩。 */

import { h, icon, btn, card, chip, fmt, get, DASH, note } from '../ui.js';

let unsub = null;
let ctxRef = null;
let el = {};
let solving = false;

const STEP_LABEL = [
  ['still', '平放静止'],
  ['forward', '往前倾'],
  ['back', '往后倾'],
  ['left', '往左倾'],
  ['right', '往右倾'],
];

export function page(ctx) {
  ctxRef = ctx;
  solving = false;

  const bubbleDot = h('div.bubble-dot');
  const bubble = h('div.bubble', { role: 'img', 'aria-label': '双轴气泡水平仪' }, bubbleDot);
  const rollText = h('span.kv-v.mono', {}, DASH);
  const pitchText = h('span.kv-v.mono', {}, DASH);
  const yawText = h('span.kv-v.mono', {}, DASH);
  const needle = h('div.compass-needle');
  const compass = h('div.compass', { role: 'img', 'aria-label': '航向罗盘' },
    h('div.compass-n', 'N'), needle);

  const postureCard = card({ title: '实时姿态', sub: 'roll / pitch / yaw' },
    h('div.bubble-box', {},
      h('div', {}, bubble),
      h('div', {}, compass)),
    h('div', { style: { marginTop: '10px' } },
      h('div.kv', {}, h('span.kv-k', 'Roll 横滚'), rollText),
      h('div.kv', {}, h('span.kv-k', 'Pitch 俯仰'), pitchText),
      h('div.kv', {}, h('span.kv-k', 'Yaw 航向'), yawText)),
    h('div.hint-line', { style: { marginTop: '8px' } },
      '气泡偏移按 ±25° 满量程画；读数来自 state.imu。'));

  const bigBtn = h('button', { class: 'wiz-btn', type: 'button', onclick: () => onBigButton() },
    h('span', {}, '开始采集'));
  const subText = h('div.wiz-sub', {}, '把鸭子放平、手离开，再开始');
  const whyText = h('div.hint-line', { style: { marginTop: '6px' } });

  const stepsBox = h('div.imu-steps');
  const wizardCard = card({ title: '方向采集', sub: '五步，缺一步就没法判装反' },
    bigBtn, subText, whyText,
    h('div', { style: { marginTop: '12px' } }, stepsBox));

  const beforeBig = h('div.big', {}, DASH);
  const afterBig = h('div.big', {}, DASH);
  const beforeSm = h('div.sm', {}, '');
  const afterSm = h('div.sm', {}, '');
  const deltaLine = h('div.hint-line', {});
  const checksBox = h('div.stack-8', {});
  const writeBtn = btn('写入标定', { kind: 'primary', disabled: true, onClick: () => commit() });
  const resultCard = card({ title: '校准结果', sub: '校准前 / 校准后' },
    h('div.result-pair', {},
      h('div.result-card', {}, h('div.hd', '校准前'), beforeBig, beforeSm),
      h('div.result-card.after', {}, h('div.hd', '校准后'), afterBig, afterSm)),
    h('div', { style: { marginTop: '10px' } }, deltaLine),
    h('div', { style: { marginTop: '10px' } }, checksBox),
    h('div.row', { style: { marginTop: '12px' } }, writeBtn,
      h('span.hint-line', {}, '写进 state_dir/imu_calib.json，下一次启动仍然生效。')));

  const stateChip = h('div.row', {});
  const paramsBox = h('div.stack-8');

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', 'IMU 方向'),
        h('div.page-desc', '先采平放，再前后左右各倾一次。解算会同时检查模块装反了没有。')),
      h('div.page-head-actions', {}, stateChip)),
    h('div.imu-layout', {},
      h('div.stack', {}, postureCard, card({ title: '判定参数', sub: '和后端同名同值，前端更严' }, paramsBox)),
      h('div.stack', {}, wizardCard, resultCard)));

  el = {
    bubbleDot, rollText, pitchText, yawText, needle, bigBtn, subText, whyText,
    stepsBox, beforeBig, afterBig, beforeSm, afterSm, deltaLine, checksBox, writeBtn,
    stateChip, paramsBox,
  };
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  ctxRef = null;
  el = {};
  solving = false;
}

/* ---------------------------------------------------------------- 绘制 */
function paint(ctx) {
  const st = ctx.state() || {};
  const imu = st.imu || {};
  const wiz = imu.wizard || {};
  const ok = imu.ok === true;

  const roll = ok ? Number(imu.roll) : NaN;
  const pitch = ok ? Number(imu.pitch) : NaN;
  const yaw = ok ? Number(imu.yaw) : NaN;

  el.rollText.textContent = Number.isFinite(roll) ? fmt.deg(roll) : DASH;
  el.pitchText.textContent = Number.isFinite(pitch) ? fmt.deg(pitch) : DASH;
  el.yawText.textContent = Number.isFinite(yaw) ? fmt.deg(yaw) : DASH;

  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  if (Number.isFinite(roll) || Number.isFinite(pitch)) {
    const rx = clamp(Number.isFinite(roll) ? roll : 0, 25) / 25 * 44;
    const ry = clamp(Number.isFinite(pitch) ? pitch : 0, 25) / 25 * 44;
    el.bubbleDot.style.transform = `translate(calc(-50% + ${rx.toFixed(1)}px), calc(-50% + ${ry.toFixed(1)}px))`;
  } else {
    el.bubbleDot.style.transform = 'translate(-50%, -50%)';
  }
  if (Number.isFinite(yaw)) el.needle.style.transform = `rotate(${yaw.toFixed(1)}deg)`;
  else el.needle.style.transform = 'rotate(0deg)';

  // 顶部状态
  el.stateChip.replaceChildren(
    chip(ok ? 'IMU 在线' : '读不到 IMU', ok ? 'ok' : 'danger'),
    chip(imu.chip || '未知芯片'),
    imu.calibrated ? chip('已校准', 'ok') : chip('未校准', 'warn'),
  );

  // 大按钮
  const result = wiz.result;
  const running = Boolean(wiz.running);
  const ready = Boolean(wiz.ready);
  el.bigBtn.classList.toggle('is-running', running);
  el.bigBtn.disabled = solving || !ok;
  if (solving) {
    el.bigBtn.replaceChildren(h('span.spin'), h('span', {}, '正在解算…'));
    el.subText.textContent = '别碰鸭子，几秒钟';
  } else if (running) {
    el.bigBtn.replaceChildren(icon('record', 16), h('span', {}, '结束采集'));
    el.subText.textContent = `正在采：第 ${Math.min(5, (wiz.step ?? 0) + 1)}/5 步 · ${fmt.sec(wiz.elapsed_s, 1)}`;
  } else if (ready) {
    el.bigBtn.replaceChildren(h('span', {}, '开始解算'));
    el.subText.textContent = '五段都采到了，开始算偏差';
  } else if (result) {
    el.bigBtn.replaceChildren(icon('refresh', 16), h('span', {}, '重新采集'));
    el.subText.textContent = '上一次结果在右边；重采会覆盖当前数据';
  } else {
    el.bigBtn.replaceChildren(h('span', {}, '开始采集'));
    el.subText.textContent = ok ? '把鸭子放平、手离开，再开始' : '先接上 IMU';
  }
  el.whyText.textContent = wiz.why || '';

  // 五步
  const steps = wiz.steps || STEP_LABEL.map(([key, label]) => ({ key, label, done: false, active: false, n: 0, progress: 0 }));
  el.stepsBox.replaceChildren(...steps.map((s) => {
    const state = s.done ? 'done' : s.active ? 'active' : 'idle';
    return h('div.imu-step', { dataset: { state } },
      h('div.lb', {}, h('i'), h('span', {}, s.label || STEP_LABEL.find(([k]) => k === s.key)?.[1] || s.key)),
      h('div.hs', {}, s.done ? `已采 ${s.n} 帧` : s.active ? `采集中 · ${Math.round((s.progress || 0) * 100)}%` : s.hint || '等待'),
      h('div.bar', {}, h('i', { style: { width: `${Math.round((s.done ? 1 : s.progress || 0) * 100)}%` } })));
  }));

  // 参数
  const params = wiz.params || {};
  el.paramsBox.replaceChildren(...Object.entries(params).map(([k, v]) =>
    h('div.kv', {}, h('span.kv-k', k), h('span.kv-v.mono', String(v)))));

  // 结果
  if (result) {
    const b = result.before || [null, null];
    const a = result.after || [null, null];
    el.beforeBig.replaceChildren(
      h('span.live-num', Number.isFinite(Number(b[0])) ? fmt.f1(b[0]) : DASH),
      h('span.unit', '° / roll'));
    el.afterBig.replaceChildren(
      h('span.live-num', Number.isFinite(Number(a[0])) ? fmt.f1(a[0]) : DASH),
      h('span.unit', '° / roll'));
    el.beforeSm.textContent = `pitch ${fmt.f1(b[1])}°`;
    el.afterSm.textContent = `pitch ${fmt.f1(a[1])}°`;
    el.deltaLine.textContent = `最大偏角减少 ${fmt.f1(result.delta_deg)}°，残差 ${fmt.deg(result.residual_deg)}（阈值 ${fmt.deg(result.level_deg)}）`
      + (result.ok ? '。与主程序差 < 2° 视为核对过。' : '。');
    el.checksBox.replaceChildren(...(result.checks || []).map((c) =>
      h('div.row', { style: { gap: '6px' } },
        icon(c.ok ? 'check' : 'alert', 14),
        h('span', { style: { color: c.ok ? 'var(--brand-ink)' : 'var(--danger-ink)' } }, c.label),
        h('span.mono.muted', {}, fmt.deg(c.deg)))));
    if (result.why) el.checksBox.append(h('div.hint-line', { style: { color: 'var(--danger-ink)' } }, result.why));
    el.writeBtn.disabled = !result.ok || solving || Boolean(imu.calibrated);
    el.writeBtn.replaceChildren(h('span', {}, imu.calibrated ? '已写入' : '写入标定'));
  } else {
    el.beforeBig.replaceChildren(h('span', {}, DASH));
    el.afterBig.replaceChildren(h('span', {}, DASH));
    el.beforeSm.textContent = '';
    el.afterSm.textContent = '';
    el.deltaLine.textContent = '还没解算过。';
    el.checksBox.replaceChildren(h('div.hint-line', {}, '开始采集后，这里会显示四个方向是否都对。'));
    el.writeBtn.disabled = true;
  }
}

/* ---------------------------------------------------------------- 动作 */
async function onBigButton() {
  const ctx = ctxRef;
  if (!ctx) return;
  const wiz = get(ctx.state(), 'imu.wizard', {}) || {};
  try {
    if (wiz.running) {
      await ctx.run('imu.op', { op: 'stop' });
      return;
    }
    if (wiz.ready && !solving) {
      solving = true;
      paint(ctx);
      try {
        const res = await ctx.run('imu.op', { op: 'solve' }, { timeout: 30000 });
        if (res && res.ok === false) ctx.toast(res.why || '解算没通过', 'warn', 6000);
        else ctx.toast('解算完成，看下面的前后对比', 'ok');
      } finally {
        solving = false;
      }
      paint(ctx);
      return;
    }
    await ctx.run('imu.op', { op: 'start' });
  } catch { /* ctx.run 已提示 */ }
}

async function commit() {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    await ctx.run('imu.op', { op: 'commit' });
    ctx.toast('IMU 标定已写入', 'ok');
  } catch { /* 已提示 */ }
}
