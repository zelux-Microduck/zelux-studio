import { h, btn, card, DASH } from '../ui.js';
import { managementView } from './imu-management-state.js';

const DIRECTIONS = { down: '下方', right: '右侧', back: '后方', up: '上方' };

export function createImuManagement(ctx) {
  let current = {}, busy = false, signature = '', disposed = false;
  const configText = h('span.kv-v.mono');
  const effective = h('span.kv-v.mono');
  const driver = h('span.kv-v.mono');
  const mount = h('span.kv-v.mono');
  const health = h('span.kv-v');
  const application = h('div.hint-line');
  const error = h('div.hint-line');
  const description = h('div.hint-line');
  const calibrationStatus = h('span.kv-v');
  const calibrationSteps = h('div.hint-line');
  const calibrationResult = h('div.hint-line');
  const select = h('select.input', { 'aria-label': 'robotd IMU 型号', onchange: describe });
  const save = btn('保存型号（不重启）', { onClick: choose });
  const restart = btn('重启 robotd 生效', { kind: 'warn', onClick: apply });
  const refresh = btn('刷新状态', { onClick: () => operate('imu.management_status', {}) });
  const calibrationStart = btn('开始机体对齐标定', { kind: 'primary', onClick: startCalibration });
  const calibrationCapture = btn('采集当前姿态', { onClick: captureCalibration });
  const calibrationSolve = btn('解算对齐', { onClick: solveCalibration });
  const calibrationSave = btn('保存标定（重启后应用）', { onClick: saveCalibration });
  const calibrationClear = btn('清除本次采集', { onClick: clearCalibration });
  const row = (label, value) => h('div.kv', {}, h('span.kv-k', label), value);
  const element = card({ title: 'robotd IMU 型号与驱动', sub: '共享总线仅由 robotd 读取；保存与重启分开' },
    row('已保存配置', configText), row('运行进程加载', effective), row('运行驱动 / 版本', driver),
    row('运行安装配置', mount), row('运行健康状态', health), application,
    h('div.row', { style: { marginTop: '12px', gap: '8px' } }, select, save, restart, refresh),
    description, error,
    h('hr'), h('h3', { style: { margin: '8px 0' } }, '机体对齐标定'),
    row('标定状态', calibrationStatus), calibrationSteps, calibrationResult,
    h('div.row', { style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } },
      calibrationStart, calibrationCapture, calibrationSolve, calibrationSave, calibrationClear),
    h('p.hint-line', '标定用 robotd 状态流的重力向量，通过立正、前后倾、左右倾五个姿态解算“当前 IMU 坐标到机体坐标”的三维修正；不直接读取串口。运行姿态使用“型号标称安装映射 + 标定修正”，标定后由 robotd 应用完整组合旋转。保存后需重启 robotd；B1 驱动与标定当前不可用。'));

  function describe() {
    const model = current.catalog?.models?.find(m => m.id === select.value);
    const axes = model?.sensor_axes;
    description.textContent = model ? model.id + ' · ' + (axes ? '+X 朝' + (DIRECTIONS[axes[0]] || axes[0])
      + '，+Y 朝' + (DIRECTIONS[axes[1]] || axes[1]) + '，+Z 朝' + (DIRECTIONS[axes[2]] || axes[2]) : '')
      + ' · ' + (model.compatible && model.supported ? '配置兼容（仍需实机验收）' : (model.reason || '不支持')) : '等待 robotctl 型号目录';
    save.disabled = busy || !managementView(current).canSave || !model?.compatible || !model?.supported;
  }

  function paint(data = {}) {
    if (disposed) return;
    current = data;
    const view = managementView(data);
    configText.textContent = view.configured;
    effective.textContent = view.effective;
    driver.textContent = view.driver;
    mount.textContent = view.mount;
    health.textContent = view.health + ' · 累计重复/过期 ' + (data.sensor?.stale_blocks ?? DASH)
      + ' · 连续 ' + (data.sensor?.consecutive_stale_blocks ?? DASH);
    application.textContent = view.application;
    error.textContent = data.error || '';
    const cal = data.mount_calibration || {};
    const wizard = data.mount_calibration_wizard || {};
    const selectedCalibration = data.catalog?.models?.find(m => m.id === data.catalog?.config?.imu?.model);
    calibrationStatus.textContent = !data.available ? '状态未知'
      : data.catalog?.config?.imu?.source !== 'imu-dxl' || selectedCalibration?.calibration_supported !== true
        ? '当前来源 / 型号不适用'
        : cal.status === 'applied' ? '已标定，运行进程已应用'
          : cal.status === 'pending_restart' ? '已保存，待重启应用'
            : cal.status === 'not_calibrated' ? '尚未标定' : '状态未知';
    calibrationSteps.textContent = wizard.running
      ? (wizard.steps || []).filter(s => s.done).length + '/5 已采集 · 当前：'
        + ((wizard.steps || []).find(s => s.active)?.label || wizard.step_key || '等待姿态')
        + ' · ' + ((wizard.steps || []).find(s => s.active)?.hint || '')
      : wizard.ready ? '五个姿态已采集，可以解算。'
        : wizard.why || '采集流程：机体立正 → 前倾 → 后倾 → 左倾 → 右倾。';
    const solved = wizard.result;
    calibrationResult.textContent = solved
      ? '完整标定修正 WXYZ [' + solved.correction_wxyz.map(v => Number(v).toFixed(4)).join(', ')
        + ']' + (Array.isArray(solved.delta_correction_wxyz)
          ? ' · 本次增量 WXYZ [' + solved.delta_correction_wxyz.map(v => Number(v).toFixed(4)).join(', ') + ']'
          : '')
        + ' · 最大轴向残差 ' + solved.max_axis_error_deg + '°'
      : Array.isArray(cal.correction_wxyz)
        ? '已保存的机体对齐修正 WXYZ [' + cal.correction_wxyz.map(v => Number(v).toFixed(4)).join(', ') + ']'
        : '';
    const next = JSON.stringify([data.catalog?.models, data.catalog?.revision]);
    if (next !== signature) {
      signature = next;
      const previous = select.value;
      const models = data.catalog?.models || [];
      select.replaceChildren(...models.map(m => h('option', { value: m.id, disabled: !m.compatible || !m.supported },
        m.id + (!m.compatible || !m.supported ? '（不可启用）' : ''))));
      const wanted = data.catalog?.config?.imu?.model || previous;
      if (models.some(m => m.id === wanted)) select.value = wanted;
    }
    select.disabled = busy || !view.canSave;
    restart.disabled = busy || !view.canRestart;
    refresh.disabled = busy;
    const selectedModel = data.catalog?.models?.find(m => m.id === data.catalog?.config?.imu?.model);
    const canCalibrate = view.canSave && selectedModel?.calibration_supported === true
      && data.ready === true && data.pending_restart === false
      && data.catalog?.config?.imu?.source === 'imu-dxl'
      && data.catalog?.config?.imu?.model === selectedModel.id;
    calibrationStart.disabled = busy || !canCalibrate || wizard.running === true;
    calibrationCapture.disabled = busy || !canCalibrate || wizard.running !== true;
    calibrationSolve.disabled = busy || !canCalibrate || wizard.ready !== true;
    calibrationSave.disabled = busy || !canCalibrate || !solved
      || JSON.stringify((cal.correction_wxyz || [1, 0, 0, 0]).map(Number))
        === JSON.stringify(solved.correction_wxyz.map(Number));
    calibrationClear.disabled = busy || (!wizard.running && !wizard.ready && !wizard.result);
    describe();
  }

  async function operate(command, args) {
    if (busy || disposed) return;
    busy = true;
    paint(current);
    try {
      const result = await ctx.run(command, args, { timeout: 50000 });
      if (!disposed && result?.management) paint(result.management);
      return result;
    } catch { /* ctx.run reports errors */ }
    finally { busy = false; if (!disposed) paint(current); }
  }

  async function choose() {
    const model = select.value;
    const expected = current.catalog?.revision;
    if (!await ctx.confirm({ title: '保存 IMU 型号', message: '确认实物是 ' + model + ' 且符合固定安装方向。仅保存配置，不会立即切换或重启。', okText: '保存配置' })) return;
    const out = await operate('imu.model_select', { model, expected });
    if (out?.saved) ctx.toast('型号已保存；请在安全条件下重启 robotd', 'ok');
  }

  async function startCalibration() {
    if (!await ctx.confirm({ title: '开始机体对齐标定',
      message: '请停止机器人动作、托稳机体并安排现场看护。标定只订阅 robotd 状态，不会驱动舵机或直接读取总线。',
      okText: '机体已支撑，开始' })) return;
    await operate('imu.op', { op: 'mount_calibration_start', confirm: true, mechanically_supported: true });
  }

  async function captureCalibration() {
    await operate('imu.op', { op: 'mount_calibration_capture' });
  }

  async function solveCalibration() {
    await operate('imu.op', { op: 'mount_calibration_solve' });
  }

  async function saveCalibration() {
    const expected = current.catalog?.revision;
    if (!await ctx.confirm({ title: '保存机体对齐标定',
      message: '将标定修正写入 robotd 配置；当前运行状态不会立即改变，需要之后单独重启应用。',
      okText: '保存标定' })) return;
    const out = await operate('imu.op', { op: 'mount_calibration_commit', expected });
    if (out?.saved) ctx.toast('标定已保存，待安全重启 robotd 后应用', 'ok');
  }

  async function clearCalibration() {
    await operate('imu.op', { op: 'mount_calibration_clear' });
  }

  async function apply() {
    const expected = current.catalog?.revision;
    if (!await ctx.confirm({ title: '安全确认：重启 robotd', message: '重启会中断控制，不能把保持姿势视为安全保证。请先停止运动、提供机械支撑并安排现场断电看护。确认这些条件均已满足？', okText: '已支撑，重启' })) return;
    const out = await operate('imu.model_restart', { expected, confirm: true, mechanically_supported: true });
    if (out) ctx.toast(out.applied ? '已确认新进程加载配置；健康状态仍需核对' : '已请求重启，尚未确认生效，请刷新状态', out.applied ? 'ok' : 'warn', 6000);
  }
  paint();
  return { element, paint, dispose() { disposed = true; } };
}
