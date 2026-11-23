/* 共享真实 MicroDuck CAD 3D 姿态渲染器；保留现有舵机元数据与页面接口。 */
import { Duck3D, JOINT_NAMES as MODEL_JOINT_NAMES } from '../duck3d.js';

export const JOINTS = [
  { id: 10, idx: 0, key: 'right_hip_yaw', cn: '右髋偏航', group: '右腿' },
  { id: 11, idx: 1, key: 'right_hip_roll', cn: '右髋横滚', group: '右腿' },
  { id: 12, idx: 2, key: 'right_hip_pitch', cn: '右髋俯仰', group: '右腿' },
  { id: 13, idx: 3, key: 'right_knee', cn: '右膝', group: '右腿' },
  { id: 14, idx: 4, key: 'right_ankle', cn: '右踝', group: '右腿' },
  { id: 20, idx: 5, key: 'left_hip_yaw', cn: '左髋偏航', group: '左腿' },
  { id: 21, idx: 6, key: 'left_hip_roll', cn: '左髋横滚', group: '左腿' },
  { id: 22, idx: 7, key: 'left_hip_pitch', cn: '左髋俯仰', group: '左腿' },
  { id: 23, idx: 8, key: 'left_knee', cn: '左膝', group: '左腿' },
  { id: 24, idx: 9, key: 'left_ankle', cn: '左踝', group: '左腿' },
  { id: 30, idx: 10, key: 'neck_pitch', cn: '颈部俯仰', group: '头颈' },
  { id: 31, idx: 11, key: 'head_pitch', cn: '头部俯仰', group: '头颈' },
  { id: 32, idx: 12, key: 'head_yaw', cn: '头部偏航', group: '头颈' },
  { id: 33, idx: 13, key: 'head_roll', cn: '头部横滚', group: '头颈' },
  { id: 34, idx: 14, key: 'mouth', cn: '嘴巴', group: '头颈' },
];

export const JOINT_MAP = new Map(JOINTS.map((joint) => [joint.id, joint]));
export const IDS = JOINTS.map((joint) => joint.id);

const CENTER = 2048;
const RAD_PER_TICK = (Math.PI * 2) / 4096;
const JOINT_ID_BY_MODEL_NAME = {
  left_hip_yaw: 20, left_hip_roll: 21, left_hip_pitch: 22, left_knee: 23, left_ankle: 24,
  neck_pitch: 30, head_pitch: 31, head_yaw: 32, head_roll: 33, mouth: 34,
  right_hip_yaw: 10, right_hip_roll: 11, right_hip_pitch: 12, right_knee: 13, right_ankle: 14,
};
const MODEL_INDEX_BY_ID = new Map(MODEL_JOINT_NAMES.map((name, index) => [JOINT_ID_BY_MODEL_NAME[name], index]));
const ROBOTD_IDS = [20, 21, 22, 23, 24, 30, 31, 32, 33, 34, 10, 11, 12, 13, 14];
const BACKEND_INDEX_BY_ID = new Map(ROBOTD_IDS.map((id, index) => [id, index]));
const BACKEND_NAME_BY_MODEL_NAME = {
  left_hip_yaw: 'l_hip_yaw', left_hip_roll: 'l_hip_roll', left_hip_pitch: 'l_hip_pitch', left_knee: 'l_knee', left_ankle: 'l_ankle',
  neck_pitch: 'neck_pan', head_pitch: 'neck_tilt', head_yaw: 'head_pan', head_roll: 'head_tilt', mouth: 'beak',
  right_hip_yaw: 'r_hip_yaw', right_hip_roll: 'r_hip_roll', right_hip_pitch: 'r_hip_pitch', right_knee: 'r_knee', right_ankle: 'r_ankle',
};

export function rad(ticks) {
  const value = Number(ticks);
  return Number.isFinite(value) ? (value - CENTER) * RAD_PER_TICK : 0;
}

export function deg(ticks) {
  return (rad(ticks) * 180) / Math.PI;
}

export function normalizePose(pose) {
  const out = new Float64Array(15).fill(CENTER);
  if (!pose) return out;
  if (Array.isArray(pose)) {
    if (pose.some((item) => item && typeof item === 'object')) {
      for (const item of pose) {
        const idx = IDS.indexOf(Number(item.id));
        const value = Number(item.pos ?? item.position);
        if (idx >= 0 && Number.isFinite(value)) out[idx] = Math.min(4095, Math.max(0, value));
      }
      return out;
    }
    for (let i = 0; i < 15; i += 1) {
      const value = Number(pose[i]);
      if (Number.isFinite(value)) out[i] = Math.min(4095, Math.max(0, value));
    }
    return out;
  }
  if (Array.isArray(pose.items)) return normalizePose(pose.items);
  for (const [key, value] of Object.entries(pose)) {
    const idx = IDS.indexOf(Number(key));
    if (idx >= 0 && Number.isFinite(Number(value))) out[idx] = Math.min(4095, Math.max(0, Number(value)));
  }
  return out;
}

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function modelJointsFromTicks(ticks, directions = null) {
  const values = new Array(MODEL_JOINT_NAMES.length).fill(0);
  for (const joint of JOINTS) {
    const modelIndex = MODEL_INDEX_BY_ID.get(joint.id);
    if (modelIndex != null) values[modelIndex] = rad(ticks[joint.idx]) * (directions?.get(joint.id) ?? 1);
  }
  return values;
}

export function mapRobotJointValues(joints) {
  let values = null;
  if (Array.isArray(joints) && joints.length >= JOINTS.length) {
    // robot.state.joints follows the backend JOINT_NAMES / servo ID order,
    // while the CAD model has its own left-leg-first order.
    values = MODEL_JOINT_NAMES.map((name) => {
      const id = JOINT_ID_BY_MODEL_NAME[name];
      return Number(joints[BACKEND_INDEX_BY_ID.get(id)]);
    });
  } else if (joints && typeof joints === 'object') {
    values = MODEL_JOINT_NAMES.map((name) => {
      const id = JOINT_ID_BY_MODEL_NAME[name];
      const backendName = BACKEND_NAME_BY_MODEL_NAME[name];
      return Number(joints[name] ?? joints[backendName] ?? joints[id] ?? joints[String(id)]);
    });
  }
  return values && values.every((value) => Number.isFinite(value)) ? values : null;
}

function gravityFrom(state) {
  const robotState = state?.robot?.state;
  const gravity = robotState?.safety?.gravity ?? state?.safety?.gravity;
  if (Array.isArray(gravity) && gravity.length === 3) {
    const values = gravity.map(Number);
    if (values.every((value) => Number.isFinite(value))) return values;
  }
  // 当前 ZELUX 后端的 IMU 快照提供 roll/pitch（角度），没有直接提供 gravity 向量时，
  // 按直立基准 [0, 0, -1] 换算；这是显示用姿态，不参与任何硬件控制。
  const roll = Number(state?.imu?.roll);
  const pitch = Number(state?.imu?.pitch);
  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) return null;
  const r = (roll * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [Math.sin(p), -Math.sin(r), -Math.cos(r) * Math.cos(p)];
}

function ticksFromState(state) {
  const items = state?.servos?.items;
  return Array.isArray(items) && items.length ? normalizePose(items) : null;
}

export function createDuck(canvas, opts = {}) {
  const host = canvas.parentElement || canvas;
  const status = document.createElement('div');
  status.className = 'duck3d-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = '正在加载真实 MicroDuck 3D 模型…';
  if (host !== canvas && getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(status);

  let renderer = null;
  let alive = true;
  let mode = opts.mode === 'front' ? 'front' : 'side';
  let selectedId = null;
  let currentPose = new Float64Array(15).fill(CENTER);
  let directPose = null;
  let source = '中位姿态';
  let directions = null;
  let gravity = null;
  let onPick = null;
  let loadError = '';

  // 参考站默认机位是 front34（3/4 视角，最好看）；「正视」才用正对镜头的 front
  const viewName = () => mode === 'front' ? 'front' : 'front34';
  const updateStatus = () => {
    if (!alive) return;
    status.textContent = loadError
      ? `真实 3D 模型加载失败：${loadError}`
      : renderer?.ready
        ? `${source}${gravity ? ' · IMU 重力姿态' : ''}${selectedId == null ? '' : ` · 关节 ${selectedId}`}`
        : '正在加载真实 MicroDuck 3D 模型…';
    status.classList.toggle('is-error', Boolean(loadError));
  };
  const applySelection = () => {
    if (!renderer?.ready) return;
    const name = selectedId == null ? null : MODEL_JOINT_NAMES[MODEL_INDEX_BY_ID.get(selectedId)];
    renderer.select(name, cssColor('--duck-shell', '#86D3CC'));
  };
  const applyTheme = () => {
    if (!renderer?.ready) return;
    renderer.setColors({
      shell: cssColor('--duck-shell', '#86D3CC'),
      accent: cssColor('--duck-accent', '#F5B400'),
    });
    renderer.select(
      selectedId == null ? null : MODEL_JOINT_NAMES[MODEL_INDEX_BY_ID.get(selectedId)],
      cssColor('--duck-shell', '#86D3CC'),
    );
  };

  try {
    renderer = new Duck3D(canvas, {
      view: viewName(),
      pageScroll: opts.pageScroll === true,
      centerX: opts.centerX ?? 0.5,
      centerY: opts.centerY ?? 0.5,
      fill: opts.fill ?? 0.88,
    });
  } catch (error) {
    status.textContent = `3D 渲染器初始化失败：${error?.message || error}`;
    status.classList.add('is-error');
  }

  const onThemeChange = () => applyTheme();
  window.addEventListener('zelux-theme-change', onThemeChange);

  if (renderer) {
    renderer.onPick = (name) => {
      const id = JOINT_ID_BY_MODEL_NAME[name];
      if (id != null && alive) {
        selectedId = id;
        onPick?.(id);
      }
      applySelection();
      updateStatus();
    };
    renderer.setJoints(modelJointsFromTicks(currentPose, directions));
    renderer.load(new URL('../model/', import.meta.url).href).then(() => {
      if (!alive) return;
      applyTheme();
      renderer.setView(viewName());
      renderer.setJoints(directPose || modelJointsFromTicks(currentPose, directions));
      renderer.setGravity(gravity);
      applySelection();
      updateStatus();
    }).catch((error) => {
      if (!alive) return;
      loadError = error?.message || String(error);
      updateStatus();
    });
  }

  function setPose(pose, immediate = false) {
    currentPose = normalizePose(pose);
    directPose = null;
    source = pose ? '舵机实时刻度（已应用零位和软件方向）' : '中位姿态（非实时）';
    renderer?.setJoints(modelJointsFromTicks(currentPose, directions));
    updateStatus();
    return immediate;
  }

  function setState(state = {}) {
    const robotState = state?.robot?.state;
    const rows = state?.servos?.items || [];
    directions = new Map(rows.filter((row) => [-1, 1].includes(row.model_direction)).map((row) => [Number(row.id), row.model_direction]));
    const direct = mapRobotJointValues(robotState?.joints);
    gravity = gravityFrom(state);
    if (direct) {
      directPose = direct;
      renderer?.setJoints(directPose);
      const hz = state?.robot?.telemetry?.sample_hz;
      source = 'robotd 实测关节' + (Number.isFinite(hz) ? ' · ' + hz.toFixed(1) + ' Hz' : '');
    } else {
      directPose = null;
      const ticks = ticksFromState(state);
      if (ticks) currentPose = ticks;
      renderer?.setJoints(modelJointsFromTicks(currentPose, directions));
      source = ticks ? (directions.size === JOINTS.length ? '舵机反馈（robotd 逐关节方向）' : '舵机刻度示意（方向未确认，非标定位姿）') : '中位姿态（非实时）';
      if (state?.robot?.telemetry?.fresh === false) source = '高频反馈不可用 · ' + source;
    }
    renderer?.setGravity(gravity);
    updateStatus();
  }

  function setHighlight(id) {
    const nextId = id == null ? null : Number(id);
    if (selectedId === nextId) return;
    selectedId = nextId;
    applySelection();
    updateStatus();
  }

  function setMode(nextMode) {
    mode = nextMode === 'front' ? 'front' : 'side';
    renderer?.setView(viewName());
  }

  function pick(clientX, clientY) {
    if (!renderer?.ready) return null;
    const name = renderer.pick(clientX, clientY);
    const id = name ? JOINT_ID_BY_MODEL_NAME[name] : null;
    return id == null ? null : id;
  }

  const api = {
    setPose,
    setState,
    setHighlight,
    setMode,
    pick,
    resetView: () => renderer?.resetView(),
    get onPick() { return onPick; },
    set onPick(handler) { onPick = typeof handler === 'function' ? handler : null; },
    redraw: () => renderer?.resize(),
    get mode() { return mode; },
    get pose() { return Array.from(currentPose); },
    get points() { return {}; },
    destroy() {
      if (!alive) return;
      alive = false;
      window.removeEventListener('zelux-theme-change', onThemeChange);
      renderer?.dispose();
      status.remove();
    },
  };
  return api;
}

export function drawDuck(canvas, pose, opts = {}) {
  const duck = createDuck(canvas, { mode: opts.mode || 'side' });
  duck.setPose(pose, true);
  if (opts.highlight != null) duck.setHighlight(opts.highlight);
  duck.redraw();
  return duck;
}
