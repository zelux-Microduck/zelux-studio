/* 驱动管理：当前运行实例与待重启选择必须严格区分。 */
import { h, btn, card, chip, toast, DASH } from '../ui.js';

const KIND = { servo: '舵机', tof: 'ToF', camera: '摄像头', fan: '风扇', imu: 'IMU' };
const HEALTH = { ready: ['正常', 'ok'], unavailable: ['不可用', 'danger'], error: ['错误', 'danger'], unknown: ['未知', 'warn'] };
let ctxRef = null;
let unsub = null;
let listEl = null;
let summaryEl = null;

export function page(ctx) {
  ctxRef = ctx;
  listEl = h('div.driver-list');
  summaryEl = h('div.row.wrap');
  return h('div.page', {},
    h('div.page-head', {}, h('div', {}, h('h1.page-title', '驱动管理'),
      h('div.page-desc', '查看实际运行的硬件型号与驱动。选择会保存，重启主控后才加载新驱动。')),
      summaryEl),
    card({ title: '设备驱动', sub: 'Driver API、型号、版本、兼容性和实时健康状态' }, listEl));
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint());
  paint();
}

export function unmount() {
  if (unsub) unsub();
  unsub = null; ctxRef = null; listEl = null; summaryEl = null;
}

function paint() {
  if (!ctxRef || !listEl) return;
  const data = ctxRef.state()?.drivers || {};
  // This list is Agent HAL only; robotd owns its own bus IMU adapter. See IMU page.
  const active = data.items || [];
  const available = data.available || [];
  const pending = data.pending || {};
  summaryEl.replaceChildren(
    chip('Agent HAL 驱动（总线 IMU 请在 IMU 页配置）'),
    chip(`Driver API ${data.api_version || DASH}`),
    chip(`${active.length}/5 类设备`, active.length === 5 ? 'ok' : 'warn'),
    data.restart_required ? chip('待重启生效', 'warn') : chip('配置已生效', 'ok'));
  if (!active.length) {
    listEl.replaceChildren(h('div.empty', {}, h('strong', '尚未收到驱动状态'), h('p', '确认 Agent 已启用 drivers 模块。')));
    return;
  }
  listEl.replaceChildren(...active.map((item) => driverRow(item, available, pending[item.device_class])));
}

function driverRow(item, available, pendingId) {
  const choices = available.filter((x) => x.device_class === item.device_class);
  const selected = pendingId || item.id;
  const select = h('select.input.driver-select', { 'aria-label': `${KIND[item.device_class] || item.device_class}驱动` },
    ...choices.map((x) => h('option', { value: x.id, selected: x.id === selected }, `${x.name} · ${x.version}`)));
  const apply = btn(pendingId ? '已保存' : '选择', {
    size: 'sm', kind: pendingId ? 'outline' : 'primary', disabled: pendingId,
    onClick: () => choose(item.device_class, select.value, apply),
  });
  const health = HEALTH[item.health] || HEALTH.unknown;
  const models = (item.detected_models || []).join(' / ') || '尚未识别';
  return h('div.driver-row', {},
    h('div.driver-main', {},
      h('div.row.wrap', {}, h('strong', {}, KIND[item.device_class] || item.device_class),
        chip(health[0], health[1]), pendingId ? chip('重启后切换', 'warn') : chip('当前运行', 'ok'),
        item.load_fallback ? chip('已回退默认驱动', 'danger') : null),
      h('div.driver-name', {}, item.name || item.id),
      h('div.driver-meta.mono', {}, item.id),
      item.load_error ? h('div.firmware-reasons', {}, `加载记录：${item.load_error}`) : null,
      h('div.driver-facts', {},
        fact('识别型号', models), fact('驱动版本', item.version || DASH),
        fact('接口兼容', item.compatible ? `兼容 · ${item.driver_api || DASH}` : '不兼容'), fact('提供方', item.provider || DASH))),
    h('div.driver-actions', {}, select, apply,
      pendingId ? btn('立即重启生效', { kind: 'warn', size: 'sm', onClick: reboot }) : null));
}

function fact(label, value) {
  return h('div.driver-fact', {}, h('span', {}, label), h('b', {}, value));
}

async function choose(deviceClass, driverId, button) {
  button.disabled = true;
  try {
    const out = await ctxRef.run('drivers.select', { device_class: deviceClass, driver_id: driverId });
    toast(out.restart_required ? '选择已保存，重启后生效' : '当前已经是这个驱动', 'ok');
    setTimeout(() => ctxRef.link.refocus(), 100);
  } finally { button.disabled = false; }
}

async function reboot() {
  const ok = await ctxRef.confirm({ title: '重启并切换驱动', message: '页面会断开约 40 秒。舵机会保持当前姿势，但请确保设备放置稳定。', okText: '重启' });
  if (!ok) return;
  await ctxRef.run('sys.op', { op: 'reboot', confirm: true }, { timeout: 15000 });
  toast('正在重启，新的驱动会在启动时加载', 'ok', 6000);
}
