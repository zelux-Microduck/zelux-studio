/* 固件管理：只展示已验证包；真实刷写未启用时绝不显示成功。 */
import { h, btn, card, chip, toast, DASH } from '../ui.js';

const KIND = { servo: '舵机', tof: 'ToF', camera: '摄像头', fan: '风扇', imu: 'IMU' };
const CHECK = {
  package_validated: '包完整性', driver_active: '活动驱动', driver_version: '驱动版本',
  driver_supports_upgrade: '驱动刷写能力', trusted: '发布签名', servo_torque_off: '舵机已卸力',
  safe_posture: '安全姿势', estop_not_pending: '急停状态',
};
let ctxRef = null;
let unsub = null;
let packageEl = null;
let inboxEl = null;
let jobEl = null;

export function page(ctx) {
  ctxRef = ctx;
  packageEl = h('div.firmware-list');
  inboxEl = h('div.firmware-inbox');
  jobEl = h('div.firmware-job');
  return h('div.page', {},
    h('div.page-head', {}, h('div', {}, h('h1.page-title', '固件管理'),
      h('div.page-desc', '按当前设备型号和驱动版本筛选固件，并在升级前显示风险与安全检查。'))),
    h('div.firmware-grid', {},
      card({ title: '兼容固件', sub: '仅已校验并暂存的 .zfw 包' }, packageEl),
      h('div.stack-12', {},
        card({ title: '待导入', sub: '设备固件收件箱' }, inboxEl),
        card({ title: '升级进度与结果' }, jobEl))));
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint());
  paint();
}

export function unmount() {
  if (unsub) unsub();
  unsub = null; ctxRef = null; packageEl = null; inboxEl = null; jobEl = null;
}

function paint() {
  if (!ctxRef || !packageEl) return;
  const data = ctxRef.state()?.firmware || {};
  const packages = data.packages || [];
  packageEl.replaceChildren(...(packages.length ? packages.map((item) => firmwareRow(item, data.write_enabled)) : [
    h('div.empty', {}, h('strong', '没有已验证固件'), h('p', '把签名的 .zfw 放入设备收件箱后，在右侧完成导入。')),
  ]));
  const inbox = data.inbox || [];
  inboxEl.replaceChildren(...(inbox.length ? inbox.map((item) => h('div.inbox-row', {},
    h('div', {}, h('strong.mono', {}, item.filename), h('div.driver-meta', {}, formatBytes(item.size))),
    btn('校验并导入', { size: 'sm', onClick: () => install(item.filename) }))) : [h('div.hint-line', {}, '收件箱为空。') ]));
  renderJob(data.job, data.write_enabled);
}

function firmwareRow(item, writeEnabled) {
  const reasons = item.compatibility_reasons || [];
  const risk = item.risk === 'high' ? ['高风险', 'danger'] : ['中风险', 'warn'];
  return h('div.firmware-row', {},
    h('div.row-between.wrap', {},
      h('div', {}, h('strong', {}, `${KIND[item.device_class] || item.device_class} · ${item.id}`),
        h('div.driver-meta.mono', {}, item.version_change || `${DASH} → ${item.version || DASH}`)),
      h('div.row.wrap', {}, chip(risk[0], risk[1]), chip(item.compatible ? '兼容' : '不兼容', item.compatible ? 'ok' : 'danger'))),
    h('div.driver-facts', {},
      fact('目标型号', (item.models || []).join(' / ') || DASH),
      fact('识别型号', (item.detected_models || []).join(' / ') || '未识别'),
      fact('要求驱动', item.driver || DASH), fact('签名', item.trusted ? '可信' : '不可信')),
    reasons.length ? h('div.firmware-reasons', {}, ...reasons.map((x) => h('span', {}, `• ${x}`))) : null,
    h('div.row.wrap', {},
      btn('升级前检查', { size: 'sm', disabled: !item.compatible, onClick: () => precheck(item) }),
      btn('开始升级', { size: 'sm', kind: 'primary', disabled: !item.compatible || !writeEnabled,
        title: writeEnabled ? '' : '设备端真实刷写执行器尚未启用', onClick: () => apply(item) }),
      !writeEnabled ? h('span.hint-line', {}, '当前只开放安全预检，尚未启用真实刷写。') : null));
}

function fact(label, value) { return h('div.driver-fact', {}, h('span', {}, label), h('b', {}, value)); }

async function install(filename) {
  const out = await ctxRef.run('firmware.install', { filename }, { timeout: 30000 });
  toast(`${out.id} ${out.version} 已验证`, 'ok');
  ctxRef.link.refocus();
}

async function precheck(item) {
  const out = await ctxRef.run('firmware.precheck', { firmware_id: item.id, version: item.version });
  jobEl.replaceChildren(h('div.stack-8', {},
    h('div.row.wrap', {}, chip(out.ready ? '可以升级' : '暂不能升级', out.ready ? 'ok' : 'danger'), h('strong', {}, `${item.id} ${item.version}`)),
    ...Object.entries(out.checks || {}).map(([key, ok]) => h('div.check-row', {},
      chip(ok ? '通过' : '未通过', ok ? 'ok' : 'danger'), h('span', {}, CHECK[key] || key)))));
}

async function apply(item) {
  const ok = await ctxRef.confirm({ title: '开始固件升级', message: `${item.id} 将升级到 ${item.version}。升级期间不要断电或拔线。`, okText: '开始升级', danger: true });
  if (!ok) return;
  await ctxRef.run('firmware.apply', { firmware_id: item.id, version: item.version }, { timeout: 120000 });
}

function renderJob(job, writeEnabled) {
  if (!job) {
    jobEl.replaceChildren(h('div.hint-line', {}, writeEnabled ? '当前没有升级任务。' : '刷写执行器未启用；预检结果会显示在这里。'));
    return;
  }
  const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
  jobEl.replaceChildren(h('div.stack-8', {},
    h('div.row-between', {}, h('strong', {}, job.id || '固件升级'), chip(job.status || 'unknown')),
    h('div.progress', {}, h('i', { style: { width: `${pct}%` } })),
    h('div.hint-line', {}, `${pct}% · ${job.message || ''}`),
    job.result ? h('pre.diag-pre', {}, JSON.stringify(job.result, null, 2)) : null));
}

function formatBytes(value) {
  const n = Number(value || 0);
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${Math.ceil(n / 1024)} KiB`;
}
