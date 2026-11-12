/* hash 路由：没有后端 rewrite，纯静态也能直接刷新任意页面。
   路由表同时是导航的单一真源（侧栏分组 / 底部 Tab / 页面标题都用它）。 */

export const ROUTES = [
  { path: '/', title: '总控', file: 'overview', focus: 'servos', group: '运行', tab: true, icon: 'dashboard' },
  { path: '/servos', title: '舵机', file: 'servos', focus: 'servos', group: '标定', tab: true, icon: 'servo' },
  { path: '/imu', title: 'IMU 方向', file: 'imu', focus: 'imu', group: '标定', icon: 'imu' },
  { path: '/pad', title: '手柄', file: 'pad', focus: 'pad', group: '标定', tab: true, icon: 'pad' },
  { path: '/camera', title: '摄像头', file: 'camera', focus: null, group: '感知', icon: 'camera' },
  { path: '/tof', title: 'ToF 避障', file: 'tof', focus: 'tof', group: '感知', icon: 'tof' },
  { path: '/fan', title: '风扇', file: 'fan', focus: null, group: '感知', icon: 'fan' },
  { path: '/ai', title: 'AI 语音', file: 'ai', focus: null, group: '智能', tab: true, icon: 'ai' },
  { path: '/train', title: '训练', file: 'train', focus: 'train', group: '智能', icon: 'train' },
  { path: '/logs', title: '日志', file: 'logs', focus: null, group: '系统', icon: 'logs' },
  { path: '/drivers', title: '驱动管理', file: 'drivers', focus: 'drivers', group: '系统', icon: 'settings' },
  { path: '/firmware', title: '固件管理', file: 'firmware', focus: 'firmware', group: '系统', icon: 'bolt' },
  { path: '/microduck', title: 'MicroDuck', file: 'microduck', focus: 'servos', group: '外观', icon: 'duck' },
  { path: '/settings', title: '设置', file: 'settings', focus: null, group: '系统', icon: 'settings' },
  { path: '/login', title: '登录', file: 'login', focus: null, group: '', hidden: true, icon: 'lock' },

];

export const NAV_GROUPS = ['运行', '标定', '感知', '智能', '外观', '系统'];

export const TAB_PATHS = ['/', '/servos', '/pad', '/ai'];
export const MORE_PATHS = ['/imu', '/camera', '/tof', '/fan', '/train', '/drivers', '/firmware', '/logs', '/microduck', '/settings'];

export function info(path) {
  const clean = normalize(path);
  return ROUTES.find((r) => r.path === clean) || ROUTES[0];
}

export function normalize(path) {
  if (!path) return '/';
  let p = String(path).trim();
  if (p.startsWith('#')) p = p.slice(1);
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.split('?')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function current() {
  return normalize(location.hash.replace(/^#/, ''));
}

const subs = new Set();

export function onRoute(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function navigate(path, opts = {}) {
  const target = `#${normalize(path)}`;
  if (opts.replace) {
    history.replaceState(null, '', target);
    emit();
  } else if (location.hash === target) {
    emit();
  } else {
    location.hash = target;
  }
}

function emit() {
  const path = current();
  for (const fn of [...subs]) {
    try { fn(path); } catch (err) { console.error('[router] 订阅者出错', err); }
  }
}

export function start() {
  if (!location.hash) history.replaceState(null, '', `#${current()}`);
  window.addEventListener('hashchange', emit);
  emit();
}
