/* 风扇页：按型号驱动实例数量动态展示/管理；硬件状态由 zelux-fan 服务提供。 */

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
const cardsById = new Map();
const editorById = new Map();
const draftById = new Map();
const pendingSaves = new Set();
let draftCounter = 0;
// Setup is an on-demand response, not a field in the streamed device snapshot.
let pwmSetup = null;
let setupRequest = 0;

export function page(ctx) {
  pwmSetup = null;
  setupRequest += 1;
  ctxRef = ctx;
  dragging = -1;

  const cardsHost = h('div.fan-cards', {});

  /* ---------------- 模式 ---------------- */
  const seg = h('div.seg', { role: 'group', 'aria-label': '风扇模式' },
    h('button', { type: 'button', 'data-mode': 'auto', 'aria-pressed': 'false' }, '全部恢复自动（清除手动覆盖）'));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    setMode(b.dataset.mode);
  });

  const selfTestBtn = btn('自检', { icon: 'refresh', onClick: () => selfTest() });
  const modeCard = card({ title: '模式', sub: '重启后回到自动，避免忘记手动全速' },
    h('div.row-between', {}, seg, selfTestBtn),
    h('div.hint-line', { style: { marginTop: '8px' } },
      '自动按温控曲线运行；每张卡片的滑块只临时覆盖该实例，到期恢复自动。重启清除覆盖。'));

  /* ---------------- 曲线 ---------------- */
  const curveSvg = svg('svg', { class: 'curve-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '温控曲线' });
  const serverNote = h('div.hint-line', {});
  const resetCurveBtn = btn('恢复默认', { size: 'sm', onClick: () => sendCurve([[58, 70], [64, 85], [70, 100]]) });
  const curveCard = card({ title: '温控曲线', sub: '拖三个点：温度 → 转速' },
    h('div.curve-wrap', {}, curveSvg),
    serverNote,
    h('div.row', { style: { marginTop: '10px' } }, resetCurveBtn));

  const readinessNote = h('div.hint-line', { style: { marginBottom: '10px' } }, '正在检查 PWM 引脚准备状态…');
  const setupSelect = h('select', { 'aria-label': '待配置 PWM 物理引脚' });
  const refreshSetupBtn = btn('刷新引脚状态', { size: 'sm', onClick: () => refreshPwmSetup(ctxRef) });
  const configurePinBtn = btn('预览并配置 PWM 引脚', { size: 'sm', onClick: () => configurePwmPin(ctxRef) });
  const rollbackPinBtn = btn('回滚未生效配置', { size: 'sm', onClick: () => rollbackPwmPin(ctxRef) });
  const setupControls = h('div.row', { style: { marginBottom: '10px' } }, setupSelect, configurePinBtn, rollbackPinBtn, refreshSetupBtn);
  const instanceHost = h('div.fan-instance-list', {});
  const addBtn = btn('添加风扇实例', { kind: 'primary', onClick: addInstance });
  const pinCard = card({ title: '风扇实例与引脚', sub: '选择主控物理 PWM 引脚；控制器编号由设备端解析' },
    readinessNote, setupControls, instanceHost, h('div.row', { style: { marginTop: '10px' } }, addBtn),
    h('div.hint-line', { style: { marginTop: '8px' } },
      '删除会停止该风扇并释放服务持有的 PWM/GPIO；请先确认不会影响散热。'));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '风扇'),
        h('div.page-desc', '数量由设备实例配置决定；自动温控和 PWM 控制由设备端风扇服务统一管理。')),
      h('div.page-head-actions', {}, h('span', { id: 'fan-chips' }))),
    cardsHost,
    h('div.grid-2', {}, modeCard, curveCard), pinCard);

  el = { cardsHost, instanceHost, addBtn, readinessNote, setupSelect, configurePinBtn, rollbackPinBtn, refreshSetupBtn, seg, curveSvg, serverNote, selfTestBtn, resetCurveBtn,
    chips: pageEl.querySelector('#fan-chips') };
  setupSelect.addEventListener('change', () => { if (ctxRef) paint(ctxRef); });
  drawCurve();
  return pageEl;
}

function fanCard(instance) {
  const id = instance.id;
  const pct = h('span.live-num', {}, DASH);
  const rpm = h('div.sub', {}, DASH);
  const temp = h('div.sub', {}, '');
  const pin = h('div.pin', {}, '—');
  const slider = h('input', {
    type: 'range', min: '0', max: '100', step: '5', value: '60',
    style: { width: '100%', marginTop: '8px' },
    'aria-label': `${instance.name || id} 手动转速`,
  });
  const fire = throttle((v) => {
    ctxRef.cmd('fan.op', { op: 'manual', instance_id: id, pct: v })
      .then(() => { /* 状态会回来，不乐观更新 */ })
      .catch((err) => toast(err.message || String(err), 'error'));
  }, 300);
  slider.addEventListener('input', () => fire(Number(slider.value)));

  const name = h('div.nm', instance.name || id);
  const tachHint = h('div.hint-line', { style: { marginTop: '4px' } },
    instance.tach_gpio == null ? '未配置测速输入' : `测速 GPIO${instance.tach_gpio}`);
  const cardEl = h('div.fan-card', {},
    h('div.hd', {}, h('div', {}, name, pin),
      h('span', { class: 'chip' }, id)),
    h('div.big', {}, pct, h('span.unit', '%')),
    rpm, temp,
    slider,
    tachHint);

  return { el: cardEl, pct, rpm, temp, pin, slider, id, name, tachHint };
}

export function mount(ctx) {
  ctxRef = ctx;
  bindCurveDrag(ctx);
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
  refreshPwmSetup(ctx);
}

async function refreshPwmSetup(ctx) {
  if (!ctx) return;
  const request = ++setupRequest;
  try {
    const result = await ctx.cmd('fan.op', { op: 'pwm_setup_status' });
    if (ctxRef !== ctx || request !== setupRequest) return;
    const status = result.pwm_setup || result;
    if (!status || !Array.isArray(status.mapped_pins) || !status.state) {
      throw new Error('设备返回的 PWM 引脚状态格式不完整');
    }
    pwmSetup = status;
    paint(ctx);
  } catch (err) {
    if (ctxRef === ctx && request === setupRequest) {
      pwmSetup = { state: 'unavailable', mapped_pins: [],
        reason: '读取 PWM 引脚状态失败：' + (err.message || err) };
      paint(ctx);
      toast(pwmSetup.reason, 'error');
    }
  }
}

function pinStatus(ctx) {
  return pwmSetup || ctx?.state()?.fan_pins || ctx?.state()?.fan?.pwm_readiness || {};
}

async function configurePwmPin(ctx) {
  const pinId = el.setupSelect?.value;
  if (!ctx || !pinId) { toast('请先选择一个主控物理 PWM 引脚。', 'warn'); return; }
  const selectedPin = (pinStatus(ctx).mapped_pins || []).find((pin) => pin.id === pinId);
  if (selectedPin?.state === 'reboot_required') {
    toast('该引脚配置已写入启动项，请先重启设备，再刷新引脚状态。', 'warn', 7000);
    return;
  }
  if (selectedPin && !['overlay_required', 'runtime_available'].includes(selectedPin.state)) {
    toast(selectedPin.reason || '当前板卡或系统档案不支持自动配置此引脚。', 'warn', 7000);
    return;
  }
  try {
    const previewResult = await ctx.cmd('fan.op', { op: 'pwm_setup_preview', pin_id: pinId });
    const preview = previewResult.preview || {};
    if (preview.state === 'runtime_available') {
      toast(preview.reason || '该引脚已经就绪。', 'ok');
      await refreshPwmSetup(ctx);
      return;
    }
    const details = (preview.diff || '未检测到启动配置差异。') + '\n\n配置会先备份，再启用已校验的设备树 overlay。设备必须重启后才能验证。是否应用？';
    if (!window.confirm(details)) return;
    await ctx.run('fan.op', { op: 'pwm_setup_apply', pin_id: pinId, token: preview.token, confirm: true });
    await refreshPwmSetup(ctx);
    toast('PWM overlay 配置已保存。请重启设备；重启后刷新引脚状态，通过验证后即可创建实例。', 'warn', 8000);
  } catch (err) {
    toast('PWM 引脚配置失败：' + (err.message || err), 'error', 7000);
  }
}

async function rollbackPwmPin(ctx) {
  const pinId = el.setupSelect?.value;
  const selectedPin = (pinStatus(ctx).mapped_pins || []).find((pin) => pin.id === pinId);
  if (!ctx || !['reboot_required', 'validation_failed'].includes(selectedPin?.state)) {
    toast('只有待重启或重启验证失败的配置可以从这里回滚；运行中的引脚不会在线关闭。', 'warn');
    return;
  }
  if (!window.confirm('回滚 ' + selectedPin.label + ' 尚未生效的 PWM overlay 启动配置？\n\n回滚会保留其他启动项，并需要重启；该引脚将不能用于风扇实例。')) return;
  try {
    await ctx.run('fan.op', { op: 'pwm_setup_rollback', pin_id: pinId, confirm: true });
    await refreshPwmSetup(ctx);
    toast('PWM overlay 已从启动配置中移除，请重启设备完成回滚。', 'warn', 8000);
  } catch (err) {
    toast('PWM overlay 回滚失败：' + (err.message || err), 'error', 7000);
  }
}

export function unmount() {
  pwmSetup = null;
  setupRequest += 1;
  if (unsub) unsub();
  unsub = null;
  ctxRef = null;
  el = {};
  dragging = -1;
  editorById.clear();
  pendingSaves.clear();
  draftById.clear();
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const fan = st.fan || {};
  const items = fan.items || [];
  const available = fan.available !== false;
  const mode = fan.mode === 'manual' ? 'manual' : 'auto';
  const inventory = fan.inventory || {};
  const instances = Array.isArray(inventory.instances)
    ? inventory.instances
    : (fan.pin_config?.instances || []);

  // A late authoritative snapshot may confirm a write whose reply was lost.
  for (const [id, draft] of draftById) {
    if (draft._outcomeUnknown && instances.some((item) => item.id === draft._pendingId)) {
      draftById.delete(id);
      editorById.delete(id);
    }
  }

  const readiness = pinStatus(ctx);
  for (const [id, editor] of editorById) {
    const pinFieldPart = editor.fields.pwm_pin;
    if (!pinFieldPart) continue;
    const selected = pinFieldPart.input.value;
    const rebuilt = pinField(editor.original, editor.original.pwm || {});
    if (selected) rebuilt.input.value = selected;
    syncPinOptions(pinFieldPart.input, [...rebuilt.input.children]);
    pinFieldPart.selected = rebuilt.selected;
  }
  if (el.readinessNote) {
    const mappedPins = readiness.mapped_pins || [];
    const selectedPin = mappedPins.find((pin) => pin.id === el.setupSelect?.value);
    if (el.setupSelect) {
      const options = [h('option', { value: '' }, '选择主控 PWM 引脚…')];
      for (const pin of mappedPins) {
        const stateLabel = pin.ready ? '已就绪' : pin.state === 'reboot_required' ? '待重启'
          : pin.state === 'rollback_reboot_required' ? '回滚待重启'
            : ['validation_failed', 'rollback_failed'].includes(pin.state) ? '验证失败' : '待配置';
        options.push(h('option', { value: pin.id }, pin.label + ' · ' + stateLabel));
      }
      syncPinOptions(el.setupSelect, options);
    }
    const state = selectedPin?.state || readiness.state;
    el.readinessNote.textContent = state === 'runtime_available'
      ? (selectedPin ? selectedPin.label + ' 已就绪；' : '物理引脚与 PWM 控制器已就绪；') + '实例启用时由风扇服务按需导出 PWM 通道。'
      : state === 'overlay_required'
        ? (selectedPin?.reason || readiness.reason || '需要先启用 PWM 设备树配置') + '；可预览并确认写入受信 overlay 配置，之后需要重启设备。'
        : state === 'reboot_required'
          ? (selectedPin?.reason || 'PWM 配置已保存，需重启设备。') + '重启后返回本页点击“刷新引脚状态”验证，再创建风扇实例。'
          : state === 'rollback_reboot_required'
            ? '回滚配置已保存，请重启设备；返回后刷新状态，确认 overlay 已卸载。'
            : ['validation_failed', 'rollback_failed'].includes(state)
              ? (selectedPin?.reason || '设备已经重启，但 PWM 引脚未通过验证；检查启动日志，或回滚 overlay。')
              : selectedPin?.reason || readiness.reason || 'PWM 准备状态未知；请检查设备端风扇服务。';
  }

  // Include drafts with live instances (drafts come first to show at top)
  const allInstances = [...draftById.values(), ...instances.filter((i) => !draftById.has(i.id))];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const disabled = !available || !ctx.link.online;
  const pinReady = readiness.state === 'runtime_available' && (readiness.mapped_pins || []).some((pin) => pin.ready);
  if (el.addBtn) el.addBtn.disabled = disabled || !pinReady;
  if (el.configurePinBtn) {
    const selected = (readiness.mapped_pins || []).find((pin) => pin.id === el.setupSelect?.value);
    el.configurePinBtn.disabled = disabled || !selected || !['overlay_required', 'runtime_available'].includes(selected.state);
  }
  if (el.rollbackPinBtn) {
    const selected = (readiness.mapped_pins || []).find((pin) => pin.id === el.setupSelect?.value);
    el.rollbackPinBtn.disabled = disabled || !['reboot_required', 'validation_failed'].includes(selected?.state);
  }
  if (el.refreshSetupBtn) el.refreshSetupBtn.disabled = disabled;

  const cards = allInstances.map((instance) => {
    let parts = cardsById.get(instance.id);
    if (!parts) {
      parts = fanCard(instance);
      cardsById.set(instance.id, parts);
    }
    parts.name.textContent = instance.name || instance.id;
    parts.tachHint.textContent = instance.tach_gpio == null ? '未配置测速输入' : `测速 GPIO${instance.tach_gpio}`;
    const item = itemById.get(instance.id) || {};
    const p = item.why ? DASH : (item.pct ?? DASH);
    parts.pct.replaceChildren(h('span.live-num', p === DASH ? DASH : fmt.int(p)), h('span.unit', '%'));
    parts.rpm.textContent = item.rpm == null ? '转速 —（无测速数据）' : `${fmt.int(item.rpm)} RPM`;
    parts.temp.textContent = `温度 ${fan.temp == null ? DASH : fmt.deg(fan.temp)}`;
    parts.pin.textContent = item.path || (instance.pwm
      ? `PWM${instance.pwm.chip}/${instance.pwm.channel}` : '引脚未配置');
    // Keep a live drag/focus stable while periodic state snapshots arrive.
    if (document.activeElement !== parts.slider) {
      parts.slider.value = String(p === DASH ? 0 : Math.round(Number(p)));
    }
    parts.slider.disabled = disabled || instance.enabled === false || !!instance._draft || !!item.why;
    parts.temp.textContent += instance.enabled === false ? ' · 已禁用' : item.why
      ? ' · ' + item.why : item.control_mode === 'manual' ? ' · 手动覆盖' : ' · 自动温控';
    return parts.el;
  });

  const desiredCardIds = allInstances.map((i) => i.id);
  for (const id of cardsById.keys()) {
    if (!desiredCardIds.includes(id)) cardsById.delete(id);
  }

  if (allInstances.length === 0) {
    const emptyMessage = available ? '尚无风扇实例。请在下方添加。' : '风扇控制器不可用，无法创建实例。';
    if (!el.cardsHost._fanEmpty) {
      el.cardsHost._fanEmpty = h('div.empty-state', {}, h('div.hint-line', {}, emptyMessage));
    } else {
      el.cardsHost._fanEmpty.firstChild.textContent = emptyMessage;
    }
    if (el.cardsHost.firstChild !== el.cardsHost._fanEmpty) el.cardsHost.replaceChildren(el.cardsHost._fanEmpty);
  } else if (!sameChildren(el.cardsHost, cards)) {
    el.cardsHost.replaceChildren(...cards);
  }

  const editors = allInstances.map((inst) => renderInstanceEditor(inst, disabled));
  if (!sameChildren(el.instanceHost, editors)) el.instanceHost.replaceChildren(...editors);

  // Clean up editors for instances that no longer exist
  const instanceIds = new Set(allInstances.map((i) => i.id));
  for (const [id] of editorById) {
    if (!instanceIds.has(id)) editorById.delete(id);
  }

  el.addBtn.disabled = disabled || !pinReady;

  el.seg.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    b.disabled = disabled;
  });

  if (el.selfTestBtn) el.selfTestBtn.disabled = disabled;
  if (el.resetCurveBtn) el.resetCurveBtn.disabled = disabled;

  const chips = [];
  if (fan.status_stale) chips.push(chip('实时状态待刷新', 'warn'));
  chips.push(chip(mode === 'auto' ? '自动' : '手动', mode === 'auto' ? 'ok' : 'warn'));
  const unavailableCount = items.filter((item) => item.hardware_available === false || item.why).length;
  if (unavailableCount) chips.push(chip(unavailableCount + ' 个实例硬件不可用', 'danger'));
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

// Replacing native select options on every telemetry tick closes the open menu.
// Compare visible option content, not snapshot identity (each poll is a new object).
function syncPinOptions(select, options) {
  const current = [...select.children];
  if (current.length === options.length && current.every((option, i) =>
    option.value === options[i].value && option.textContent === options[i].textContent)) return;
  const selected = select.value;
  select.replaceChildren(...options);
  select.value = options.some((option) => option.value === selected) ? selected : '';
}

function field(label, value, type = 'text', attrs = {}) {
  const input = h('input', { type, value: value ?? '', ...attrs });
  return { input, el: h('label.fan-field', {}, h('span', label), input) };
}

function pinField(instance, pwm) {
  const readiness = pinStatus(ctxRef);
  const pins = readiness.mapped_pins || [
    { id: 'radxa-zero3w-pin21-pwm12-m1', label: 'pin 21 · PWM12_M1', pin: 21, function: 'PWM12_M1', gpio: 149, chip: null, channel: 0, ready: false },
    { id: 'radxa-zero3w-pin24-pwm13-m1', label: 'pin 24 · PWM13_M1', pin: 24, function: 'PWM13_M1', gpio: 150, chip: null, channel: 0, ready: false },
  ];
  const current = instance.pwm_pin || '';
  const select = h('select', { value: current, 'aria-label': 'PWM 物理引脚' });
  select.append(h('option', { value: '' }, '选择 PWM 引脚…'));
  for (const pin of pins) select.append(h('option', { value: pin.id }, pin.label));
  const resolved = pins.find((pin) => pin.id === current)
    || (pwm && pins.find((pin) => pin.chip === Number(pwm.chip) && pin.channel === Number(pwm.channel)));
  if (resolved) select.value = resolved.id;
  return { input: select, el: h('label.fan-field', {}, h('span', '主控 PWM 引脚'), select),
    selected: () => {
      const pin = pins.find((entry) => entry.id === select.value);
      return pin && pin.ready && Number.isFinite(pin.chip)
        ? { chip: pin.chip, channel: pin.channel, pin_id: pin.id } : null;
    } };
}

function renderInstanceEditor(instance, disabled = false) {
  const existing = editorById.get(instance.id);
  if (existing) {
    // Reuse existing editor for all existing IDs - preserve user edits
    const row = existing.row;
    const fields = existing.fields;
    // ID field is immutable for persisted instances (not drafts)
    fields.id.input.disabled = !instance._draft;
    // Other fields reflect current network state
    Object.entries(fields).forEach(([key, f]) => {
      if (key !== 'id') f.input.disabled = disabled;
    });
    existing.saveBtn.disabled = disabled || pendingSaves.has(instance.id) || !!instance._outcomeUnknown;
    existing.removeBtn.disabled = disabled;
    existing.original = instance;
    existing.toggleBtn.disabled = disabled || !!instance._draft;
    existing.toggleBtn.textContent = instance.enabled === false ? '启用实例' : '禁用实例';
    return row;
  }

  const pwm = instance.pwm || {};
  const fields = {
    id: field('实例 ID', instance.id, 'text', { maxlength: '64', disabled: !instance._draft }),
    name: field('显示名称', instance.name, 'text', { maxlength: '64' }),
    pwm_pin: pinField(instance, pwm),
    tach_gpio: field('测速 GPIO（可选）', instance.tach_gpio ?? '', 'number', { min: '0', max: '65535' }),
    period_ns: field('周期 ns', instance.period_ns || 40000, 'number', { min: '1000', max: '10000000' }),
    pulses_per_rev: field('每转脉冲数', instance.pulses_per_rev || 2, 'number', { min: '1', max: '16' }),
  };
  const removeBtn = btn('删除实例', { size: 'sm', onClick: () => deleteInstance(instance.id) });
  const saveBtn = btn('保存实例', { kind: 'primary', size: 'sm', onClick: () => saveInstance(instance, fields) });
  const toggleBtn = btn(instance.enabled === false ? '启用实例' : '禁用实例', {
    size: 'sm', onClick: () => toggleInstance(instance.id),
  });
  toggleBtn.disabled = disabled || !!instance._draft;
  removeBtn.disabled = disabled;
  saveBtn.disabled = disabled || pendingSaves.has(instance.id) || !!instance._outcomeUnknown;
  // ID field already set immutable above; other fields follow network state
  Object.entries(fields).forEach(([key, f]) => {
    if (key !== 'id') f.input.disabled = disabled;
  });
  const row = card({ title: instance.name || instance.id, sub: `型号驱动：${instance.driver_id}` },
    h('div.fan-instance-fields', {}, ...Object.values(fields).map((part) => part.el)),
    h('div.row', { style: { marginTop: '10px' } }, saveBtn, toggleBtn, removeBtn));

  editorById.set(instance.id, { row, fields, saveBtn, removeBtn, toggleBtn, original: instance });
  return row;
}

function readInstance(instance, fields) {
  const value = (name) => fields[name].input.value.trim();
  const optionalNumber = (name) => {
    const v = value(name);
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const requiredNumber = (name) => {
    const v = value(name);
    if (v === '') return NaN;
    return Number(v);
  };
  const period = Number(value('period_ns'));
  const pulses = Number(value('pulses_per_rev'));
  return {
    id: value('id'),
    name: value('name'),
    driver_id: instance.driver_id || 'zelux.fan.radxa-pwm',
    enabled: instance.enabled !== false,
    pwm: fields.pwm_pin.selected(),
    pwm_pin: fields.pwm_pin.input.value,
    period_ns: Number.isFinite(period) ? period : NaN,
    tach_gpio: optionalNumber('tach_gpio'),
    pulses_per_rev: Number.isFinite(pulses) ? pulses : NaN,
  };
}

async function saveInstance(original, fields) {
  const ctx = ctxRef;
  const scope = el;
  if (!ctx || pendingSaves.has(original.id)) return;
  original = editorById.get(original.id)?.original || original;
  if (original._outcomeUnknown) {
    toast('上次保存结果尚未确认，请刷新状态核对实例，不要重复创建。', 'warn');
    return;
  }
  const instance = readInstance(original, fields);
  if (!instance.id || !instance.name) {
    toast('请填写有效的实例 ID 和名称。', 'warn');
    return;
  }
  if (!instance.pwm || !Number.isFinite(instance.pwm.chip) || !Number.isFinite(instance.pwm.channel)) {
    toast('请选择此设备档案支持的 PWM 物理引脚。', 'warn');
    return;
  }
  if (!Number.isFinite(instance.period_ns) || instance.period_ns < 1000 || instance.period_ns > 10000000) {
    toast('请填写有效的周期（1000–10000000 ns）。', 'warn');
    return;
  }
  if (instance.tach_gpio != null && (instance.tach_gpio < 0 || instance.tach_gpio > 65535)) {
    toast('测速 GPIO 必须在 0–65535 范围内。', 'warn');
    return;
  }
  if (!Number.isFinite(instance.pulses_per_rev) || instance.pulses_per_rev < 1 || instance.pulses_per_rev > 16) {
    toast('每转脉冲数必须在 1–16 范围内。', 'warn');
    return;
  }
  pendingSaves.add(original.id);
  paint(ctx);
  try {
    const op = original._draft ? 'instance_create' : 'instance_update';
    const response = await ctx.run('fan.op', { op, instance_id: original.id, instance });
    if (ctxRef !== ctx || el !== scope) return;
    draftById.delete(original.id);
    editorById.delete(original.id);
    applyFanResponse(ctx, response, scope);
    const warning = response?.result?.refresh_warning;
    toast(warning || '风扇实例已保存并由服务应用。', warning ? 'warn' : 'ok');
  } catch (err) {
    if (ctxRef !== ctx || el !== scope) return;
    if (['outcome_unknown', 'timeout', 'disconnected', 'offline'].includes(err.code) || /超时|断开|timeout/i.test(err.message || '')) {
      original._outcomeUnknown = true;
      original._pendingId = instance.id;
      toast('保存结果未知，请刷新状态核对实例；不要重复创建。', 'warn', 7000);
      // Read-only reconciliation, never replay the write.
      try { applyFanResponse(ctx, await ctx.cmd('fan.op', { op: 'status' }), scope); } catch (_) {}
    } else toast(err.message || String(err), 'error');
  } finally {
    if (ctxRef === ctx && el === scope) {
      pendingSaves.delete(original.id);
      paint(ctx);
    }
  }
}

function applyFanResponse(ctx, response, scope) {
  if (ctxRef !== ctx || el !== scope || !response?.fan) return;
  ctx.store.set('st', { ...(ctx.state() || {}), fan: response.fan });
}

async function toggleInstance(instanceId) {
  const ctx = ctxRef;
  const scope = el;
  const instance = editorById.get(instanceId)?.original;
  if (!instance || instance._draft) return;
  const enabled = instance.enabled === false;
  if (!enabled && !window.confirm('禁用会立即停止该风扇，请确认设备仍有足够散热。')) return;
  try {
    const response = await ctx.run('fan.op', { op: enabled ? 'instance_enable' : 'instance_disable', instance_id: instanceId });
    if (ctxRef !== ctx || el !== scope) return;
    applyFanResponse(ctx, response, scope);
    const warning = response?.result?.refresh_warning;
    toast(warning || (enabled ? '实例已启用，自动温控已接管。' : '实例已禁用，输出已停止。'), warning ? 'warn' : 'ok');
  } catch (err) { toast(err.message || String(err), 'error'); }
}

function sameChildren(parent, desired) {
  if (parent.children.length !== desired.length) return false;
  return desired.every((node, index) => parent.children[index] === node);
}

async function deleteInstance(instanceId) {
  const ctx = ctxRef;
  const scope = el;
  if (draftById.has(instanceId)) {
    draftById.delete(instanceId);
    editorById.delete(instanceId);
    paint(ctxRef);
    return;
  }
  const item = ctxRef?.state()?.fan?.items?.find((fan) => fan.id === instanceId);
  const label = item?.name || instanceId;
  if (!window.confirm(`删除实例”${label}”？\n\n该实例会立即停止，风扇服务持有的 PWM/GPIO 将被释放。\n请确认设备仍有足够散热。`)) return;
  try {
    const response = await ctx.run('fan.op', { op: 'instance_delete', instance_id: instanceId, confirm: true });
    if (ctxRef !== ctx || el !== scope) return;
    draftById.delete(instanceId);
    editorById.delete(instanceId);
    applyFanResponse(ctx, response, scope);
    if (response?.result?.refresh_warning) {
      toast(response.result.refresh_warning, 'warn');
      return;
    }
    const released = response?.result?.released || [];
    if (released.some((entry) => entry.ok === false)) {
      toast('服务报告资源释放失败，请检查服务状态后重试。', 'error');
      return;
    }
    if (released.length === 0) {
      toast('实例已删除（无服务持有的资源）。', 'ok');
    } else {
      const details = released.map((r) => {
        const status = r.ok === false ? '释放失败：' + (r.error || '未知原因')
          : r.unexported ? '已释放' : r.stopped ? '已停止，保留内核资源' : '未确认停止';
        return `${r.resource}（${status}）`;
      }).join('、');
      toast(`实例已删除；释放资源：${details}`, 'ok', 6000);
    }
  } catch (err) { toast(err.message || String(err), 'error'); }
}

function addInstance() {
  const id = `fan-${Date.now().toString(36)}-${(++draftCounter).toString(36)}`;
  const draft = { id, name: '新风扇', driver_id: 'zelux.fan.radxa-pwm', enabled: true,
    pwm: { chip: '', channel: '' }, pwm_pin: '', period_ns: 40000,
    tach_gpio: null, pulses_per_rev: 2, _draft: true };
  draftById.set(id, draft);
  paint(ctxRef);
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

  if (mode === 'auto') {
    ctx.run('fan.op', { op: 'auto' })
      .then(() => toast('已切自动', 'ok', 2200))
      .catch(() => {});
  } else {
    // Manual mode: use the first available instance
    const fan = ctx.state()?.fan || {};
    const instances = Array.isArray(fan.inventory?.instances)
      ? fan.inventory.instances
      : (fan.pin_config?.instances || []);

    if (instances.length === 0) {
      toast('没有风扇实例，请先添加实例。', 'warn');
      return;
    }

    const firstInstance = instances[0];
    const card = cardsById.get(firstInstance.id);
    const pct = card?.slider?.value ?? 60;

    ctx.run('fan.op', { op: 'manual', instance_id: firstInstance.id, pct: Number(pct) })
      .then(() => toast(`已切手动（实例 ${firstInstance.id}）`, 'ok', 2200))
      .catch(() => {});
  }
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
    const res = await ctx.run('fan.op', { op: 'self_test' }, { timeout: 60000 });
    if (res?.ok === null || res?.available === false) {
      toast(res.reason || '这台机器没法自检', 'warn', 6000);
    } else if (res?.ok) {
      toast(`自检通过：${res.rpm ?? '—'} RPM`, 'ok', 5000);
    } else {
      toast(res?.reason || '自检没过：转速没上来，检查供电和 4pin 线', 'error', 7000);
    }
  } catch { /* 已提示 */ }
}
