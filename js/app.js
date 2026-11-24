/* 应用外壳：登录守卫、顶栏（含急停）、侧栏/底部 Tab、横幅、数据新鲜度、路由挂载。
   页面模块只负责自己那一块；这里负责所有"跨页面"的东西。 */

import { link } from './link.js';
import * as store from './store.js';
import * as router from './router.js';
import { initTheme } from './theme.js';
import {
  h, icon, toast, toastError, confirmDialog, askDialog, fmt, get, copyText,
} from './ui.js';

const PAGE_CACHE = new Map();
const app = document.getElementById('app');

let session = null;          // {csrf, duck, version, mode, backend}
let authed = false;
let current = { mod: null, path: null, token: 0 };
let shell = null;            // 外壳里需要频繁更新的节点
let freshTimer = 0;
let bannerSig = '';
let sheetEl = null;

/* ---------------------------------------------------------------- 公共上下文 */
const ctx = {
  cmd: (name, args, opts) => link.cmd(name, args, opts),
  /** 发命令；失败时把服务端 error 原文 toast 出来，再把错误抛回给调用者 */
  async run(name, args = {}, opts = {}) {
    try {
      return await link.cmd(name, args, opts);
    } catch (err) {
      toastError(err);
      throw err;
    }
  },
  go: (path) => router.navigate(path),
  toast,
  toastError,
  confirm: confirmDialog,
  ask: askDialog,
  copy: copyText,
  store,
  link,
  state: () => store.state(),
  session: () => session,
  setCsrf: (token) => {
    link.setCsrf(token);
    if (session) session.csrf = token;
  },
  onLogin,
  logout,
  online: () => link.online,
  focusModule: () => router.info(router.current()).focus,
};

/* 让 fire-and-forget 的调用不至于出现 unhandled rejection */
function swallow(promise) {
  if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  return promise;
}

/* ---------------------------------------------------------------- 启动 */
async function boot() {
  initTheme();
  app.replaceChildren(h('div.loading', {}, h('div.spin'), '正在连设备…'));
  let data = null;
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) data = body;
    else session = { hasPassword: Boolean(body.has_password) };
  } catch (err) {
    session = { offline: true };
  }
  if (data) {
    session = data;
    link.setCsrf(data.csrf);
    authed = true;
    startShell();
  } else {
    authed = false;
    showLogin();
  }
}

function onLogin(data) {
  session = data;
  link.setCsrf(data.csrf);
  authed = true;
  router.navigate('/', { replace: true });
  startShell();
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* 断网也照样回登录页 */ }
  link.disconnect();
  authed = false;
  session = null;
  store.set('st', null);
  stopFreshTicker();
  showLogin();
  toast('已退出登录', 'ok');
}

/* ---------------------------------------------------------------- 登录页 */
async function showLogin() {
  current.mod?.unmount?.();
  current = { mod: null, path: '/login', token: current.token + 1 };
  const mod = await loadPage('login');
  const node = mod.page(ctx);
  app.replaceChildren(node);
  mod.mount?.(ctx);
  current.mod = mod;
  document.title = '登录 · ZELUX Duck Studio';
}

/* ---------------------------------------------------------------- 外壳 */
let shellWired = false;
let routerStarted = false;

function startShell() {
  if (!shellWired) {
    shellWired = true;
    link.on((data) => {
      store.set('st', data);
      store.set('stAt', Date.now());
    });
    link.onLatency((ms) => updateLatency(ms));
    link.onStatus((status, l, detail) => {
      updateConn(status, detail);
      if (status === 'open') {
        // 重连上以后立刻把当前页面关注点告诉后端，避免一直推降频数据
        link.route = router.current();
        link.focus = router.info(router.current()).focus;
        link.refocus();
      }
    });
    link.onUnauth(() => {
      authed = false;
      session = null;
      stopFreshTicker();
      showLogin();
      toast('登录过期了，重新输一次口令', 'warn', 5000);
    });
    store.subscribe(() => paintShell());
    router.onRoute((path) => renderRoute(path));
    bindGlobalKeys();
  }

  shell = buildShell();
  app.replaceChildren(shell.el);
  current.mod?.unmount?.();
  current.mod = null;
  store.set('stAt', 0);

  link.route = router.current();
  link.focus = router.info(router.current()).focus;
  link.connect();

  if (!routerStarted) {
    routerStarted = true;
    router.start();
  } else {
    setNav(router.current());
    renderRoute(router.current());
  }
  startFreshTicker();
  paintShell();
}

function buildShell() {
  const modeBadge = h('span', { class: 'chip chip-dark', id: 'mode-badge' }, '标定');
  const postureBadge = h('span', { class: 'chip chip-dark chip-mute', id: 'posture-badge' }, '—');
  const estopChip = h('span', { class: 'chip chip-dark chip-danger', id: 'estop-chip' }, '已卸力');
  estopChip.hidden = true;

  const battery = h('span', { class: 'tb-metric', id: 'battery', title: '电量' },
    icon('battery', 15), h('strong', {}, '—'));
  const cpu = h('span', { class: 'tb-metric opt', id: 'cpu', title: '主控温度' },
    icon('cpu', 15), h('strong', {}, '—'));
  const lat = h('span', { class: 'lat', id: 'lat', title: '状态延迟' }, '— ms');

  const estopBtn = h('button', {
    class: 'estop',
    id: 'estop',
    type: 'button',
    title: '急停：全部舵机卸力（空格）',
    'aria-label': '急停：立即卸掉全部舵机力量（快捷键 空格）',
    onclick: () => fireEstop(),
  }, icon('bolt', 16), h('span', {}, '卸力'), h('span', { class: 'kbd' }, '空格'));

  const topbar = h('header.topbar', {},
    h('div.topbar-brand', {},
      h('img', { src: './assets/logo.svg', alt: '', width: 26, height: 26 }),
      h('div.brand-text', {},
        h('span.brand-name', 'ZELUX'),
        h('span.brand-sub', 'Duck Studio'))),
    h('div.tb-device', {},
      h('span.chip.chip-dark.chip-ok', { id: 'conn-dot', style: { padding: '0 6px' } }, h('i.dot')),
      h('span.name', { id: 'device-name' }, 'zelux-duck'),
      h('span.ip', { id: 'device-ip' }, '')),
    h('span.tb-sep.hide-sm'),
    modeBadge,
    postureBadge,
    estopChip,
    h('div.tb-right', {}, lat, cpu, battery, estopBtn));

  const nav = h('nav.sidebar', { 'aria-label': '主导航' });
  const groups = {};
  for (const g of router.NAV_GROUPS) {
    groups[g] = h('div.nav-group', {}, h('div.nav-label', g));
    nav.append(groups[g]);
  }
  for (const r of router.ROUTES) {
    if (r.hidden || !r.group) continue;
    const item = h('a.nav-item', {
      href: `#${r.path}`,
      dataset: { path: r.path },
      'aria-label': r.title,
    }, icon(r.icon, 16), h('span', {}, r.title));
    groups[r.group].append(item);
  }
  nav.append(h('div.side-foot', {},
    h('div', { id: 'side-ver' }, '协议 v1 · 前端 1.0.0'),
    h('div.mono', { id: 'side-ip' }, '')));

  const banners = h('div.banners', { id: 'banners', role: 'status', 'aria-live': 'polite' });
  const slot = h('div', { id: 'slot' });
  const view = h('div.view', {}, banners, slot);
  const main = h('main.main', { id: 'main', tabindex: '-1' }, view);

  const tabbar = h('nav.tabbar', { 'aria-label': '底部导航' });
  for (const p of router.TAB_PATHS) {
    const r = router.info(p);
    tabbar.append(h('a.tab', { href: `#${r.path}`, dataset: { path: r.path } },
      icon(r.icon, 20), h('span', {}, r.title)));
  }
  tabbar.append(h('button.tab', {
    type: 'button', id: 'more-tab', 'aria-label': '更多页面',
    onclick: () => openSheet(),
  }, icon('more', 20), h('span', {}, '更多')));

  const el = h('div.app', {}, topbar, nav, main, tabbar);
  return { el, modeBadge, postureBadge, estopChip, battery, cpu, lat, estopBtn, banners, slot, nav, tabbar, connDot: topbar.querySelector('#conn-dot') };
}

/* ---------------------------------------------------------------- 顶栏更新 */
function paintShell() {
  if (!shell) return;
  const st = store.state() || {};
  const mode = st.mode || (session && session.mode) || null;
  const hlo = store.get('hello');

  // 模式徽章
  const modeText = mode === 'motion' ? '运动' : mode === 'commissioning' ? '标定' : '—';
  shell.modeBadge.textContent = modeText;
  shell.modeBadge.className = `chip chip-dark ${mode === 'motion' ? 'chip-ok' : mode === 'commissioning' ? 'chip-warn' : 'chip-mute'}`;

  const postureMap = {
    absent: '无主控', starting: '启动中', limp: '卸力', homing: '校零中',
    holding: '站着', walking: '在走', sitting: '坐着', servo_session: '调舵机中',
  };
  const posture = st.posture || null;
  shell.postureBadge.textContent = posture ? (postureMap[posture] || posture) : '—';

  // 设备名 / IP
  const name = get(st, 'net.host') || get(hlo, 'duck.label') || 'zelux-duck';
  const nameEl = shell.el.querySelector('#device-name');
  if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
  const ip = get(st, 'net.ip') || '';
  const ipEl = shell.el.querySelector('#device-ip');
  if (ipEl && ipEl.textContent !== ip) ipEl.textContent = ip;
  const ip2 = shell.el.querySelector('#side-ip');
  if (ip2) ip2.textContent = ip ? `http://${ip}:8000` : '';

  // 电量
  const pct = get(st, 'battery.pct');
  const volt = get(st, 'battery.v');
  const batStrong = shell.battery.querySelector('strong');
  batStrong.textContent = pct === undefined ? '—' : `${fmt.int(pct)}%`;
  shell.battery.classList.toggle('is-low', typeof pct === 'number' && pct <= 20);
  shell.battery.title = volt === undefined ? '电量' : `电量 ${fmt.int(pct)}% · ${fmt.f2(volt)} V（电压查表，误差约 ±15%）`;

  // CPU
  const temp = get(st, 'cpu.temp');
  const cpuStrong = shell.cpu.querySelector('strong');
  cpuStrong.textContent = temp === undefined ? '—' : `${fmt.int(temp)}°`;
  shell.cpu.title = `主控温度 ${temp === undefined ? '—' : fmt.f1(temp) + ' ℃'}`;

  // 急停状态
  const est = get(st, 'estop.state');
  shell.estopChip.hidden = est !== 'confirmed';
  if (est === 'confirmed') {
    // why 有时就是"已全部卸力"，跟标签重复，别再拼一遍
    const why = get(st, 'estop.why', '') || '';
    shell.estopChip.textContent = why && why !== '已全部卸力' ? `已卸力 · ${why}` : '已卸力';
  }
  shell.estopBtn.disabled = !link.online;

  // 接管会话：急停按钮旁边不动，只在横幅里体现
  const ver = shell.el.querySelector('#side-ver');
  if (ver) {
    ver.textContent = `后端 ${get(hlo, 'version') || (session && session.version) || '—'} · 协议 v1`;
  }
}

function updateLatency(ms) {
  if (!shell) return;
  if (ms === null || ms === undefined) { shell.lat.textContent = '— ms'; return; }
  shell.lat.textContent = `${fmt.int(ms)} ms`;
  shell.lat.classList.toggle('is-warn', ms > 250 && ms <= 800);
  shell.lat.classList.toggle('is-bad', ms > 800);
}

function updateConn(status, detail) {
  if (!shell) return;
  const map = {
    open: ['ok', '已连上'],
    connecting: ['warn', '连接中'],
    reconnecting: ['warn', '重连中'],
    closed: ['mute', '已断开'],
    error: ['danger', '连接出错'],
    denied: ['danger', '被拒绝'],
    unauth: ['danger', '未登录'],
  };
  const [kind, label] = map[status] || ['mute', status];
  shell.connDot.className = `chip chip-dark chip-${kind}`;
  shell.connDot.textContent = '';
  shell.connDot.append(h('i.dot'), h('span', {}, label));
  shell.connDot.title = detail || label;
  shell.estopBtn.disabled = status !== 'open';
  paintBanners();
}

/* ---------------------------------------------------------------- 横幅 */
function paintBanners() {
  if (!shell) return;
  const st = store.state() || {};
  const at = store.get('stAt', 0);
  const age = at ? (Date.now() - at) / 1000 : null;
  const sess = st.servo_session;
  const conn = link.status;

  const parts = [];
  if (conn === 'reconnecting' || conn === 'closed' || conn === 'error') {
    parts.push({
      kind: 'gray',
      text: '和设备断了，正在每 2 秒重连（最长 8 秒）。现在发不出命令。',
      actions: [['立刻重连', () => link.connect()]],
    });
  } else if (conn === 'denied') {
    parts.push({ kind: 'red', text: '来源校验没过：请用设备自己的地址（比如 http://192.168.x.x:8000）打开这个页面。' });
  }
  if (age !== null && age > 3 && conn === 'open') {
    parts.push({
      kind: 'yellow',
      text: `${Math.floor(age)} 秒没收到状态。最后一条在 ${fmt.clock(at / 1000)}，下面显示的数值可能已经过时。`,
    });
  }
  if (sess) {
    const holding = sess.holding ?? sess.online ?? '—';
    parts.push({
      kind: 'yellow',
      text: `调舵机中 · ${holding} 颗保持 · 主程序停着（离开这一页不交还）`,
      actions: [
        ['回舵机页', () => router.navigate('/servos')],
        ['交还', () => swallow(ctx.run('servo.bus', { op: 'release' }).then(() => toast('已交还舵机总线', 'ok')))],
      ],
    });
  }

  const sig = JSON.stringify(parts.map((p) => [p.kind, p.text]));
  if (sig === bannerSig) return;
  bannerSig = sig;
  shell.banners.replaceChildren(...parts.map((p) => h('div', { class: `banner banner-${p.kind}` },
    icon(p.kind === 'gray' ? 'wifiOff' : 'alert', 15),
    h('span.grow', p.text),
    p.actions ? h('div.banner-actions', ...p.actions.map(([label, fn]) => h('button', {
      class: 'btn btn-sm', type: 'button', onclick: fn,
    }, label))) : null)));
}

/* ---------------------------------------------------------------- 数据新鲜度 */
function startFreshTicker() {
  stopFreshTicker();
  const tick = () => {
    const at = store.get('stAt', 0);
    const age = at ? (Date.now() - at) / 1000 : null;
    let fresh = 'init';
    if (age === null) fresh = link.online ? 'init' : 'dead';
    else if (age <= 1) fresh = 'ok';
    else if (age <= 3) fresh = 'warn';
    else fresh = 'dead';
    if (document.body.dataset.fresh !== fresh) document.body.dataset.fresh = fresh;
    paintBanners();
  };
  freshTimer = setInterval(tick, 500);
  tick();
}

function stopFreshTicker() {
  clearInterval(freshTimer);
  freshTimer = 0;
}

/* ---------------------------------------------------------------- 急停 */
let estopBusy = false;
async function fireEstop() {
  if (estopBusy || !link.online) return;
  estopBusy = true;
  try {
    const data = await link.cmd('relax', {}, { timeout: 8000 });
    if (data && data.ok === false) {
      toast(data.error || '卸力没成功', 'error', 6000);
    } else {
      toast(data?.state === 'pending' ? (data.note || '已提交急停请求，等待硬件确认') : '已全部卸力', 'ok', 2400);
    }
  } catch (err) {
    toastError(err);
  } finally {
    estopBusy = false;
  }
}

function bindGlobalKeys() {
  if (bindGlobalKeys.done) return;
  bindGlobalKeys.done = true;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    // 焦点在按钮/链接上时，空格是"激活这个控件"，不能抢；急停仍可按顶栏红键（Tab 可达）
    const onControl = tag === 'BUTTON' || tag === 'A';
    if (e.code === 'Space' && !typing && !onControl && !e.repeat) {
      e.preventDefault();
      fireEstop();
    }
    if (e.key === 'Escape' && sheetEl) closeSheet();
  });
  document.addEventListener('visibilitychange', () => link.refocus());
  window.addEventListener('online', () => { link.connect(); });
}

/* ---------------------------------------------------------------- 路由 */
async function loadPage(file) {
  if (PAGE_CACHE.has(file)) return PAGE_CACHE.get(file);
  const url = new URL(`./pages/${file}.js`, import.meta.url).href;
  const mod = await import(url);
  PAGE_CACHE.set(file, mod);
  return mod;
}

function setNav(path) {
  if (!shell) return;
  const info = router.info(path);
  for (const a of shell.el.querySelectorAll('.nav-item')) {
    const p = a.dataset.path;
    if (p === info.path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  let inMore = false;
  for (const a of shell.tabbar.querySelectorAll('a.tab')) {
    const p = a.dataset.path;
    if (p === info.path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  inMore = router.MORE_PATHS.includes(info.path);
  const more = shell.el.querySelector('#more-tab');
  if (more) {
    if (inMore) more.classList.add('is-active');
    else more.classList.remove('is-active');
  }
}

async function renderRoute(path) {
  const info = router.info(path);
  if (!authed) { showLogin(); return; }
  if (info.path === '/login') { router.navigate('/', { replace: true }); return; }
  const token = current.token + 1;
  current.token = token;

  link.route = info.path;
  link.focus = info.focus;
  link.refocus();
  document.title = `${info.title} · ZELUX Duck Studio`;
  setNav(info.path);
  if (sheetEl) closeSheet();

  let mod;
  try {
    mod = await loadPage(info.file);
  } catch (err) {
    console.error('页面加载失败', info.file, err);
    if (token !== current.token) return;
    shell.slot.replaceChildren(h('div.card', {}, h('div.card-body', {},
      h('div.note.note-danger', {}, icon('alert', 15),
        h('div', {}, `页面 ${info.file}.js 加载失败：${err.message || err}`)))));
    return;
  }
  if (token !== current.token) return;
  try { current.mod?.unmount?.(); } catch (err) { console.error('unmount 出错', err); }
  let node;
  try {
    node = mod.page(ctx);
  } catch (err) {
    console.error('page() 出错', info.file, err);
    node = h('div.card', {}, h('div.card-body', {},
      h('div.note.note-danger', {}, icon('alert', 15),
        h('div', {}, `这一页画不出来：${err.message || err}`))));
  }
  shell.slot.replaceChildren(node);
  current.mod = mod;
  current.path = info.path;
  try { mod.mount?.(ctx); } catch (err) { console.error('mount 出错', info.file, err); }
}

/* ---------------------------------------------------------------- 更多（移动端） */
function openSheet() {
  if (sheetEl) return;
  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '更多页面' },
    h('div.sheet-grab'),
    h('div.sheet-title', '更多'),
    h('div.sheet-grid', ...router.ROUTES.filter((r) => !r.hidden && r.path !== '/')
      .map((r) => h('a.sheet-item', {
        href: `#${r.path}`,
        onclick: () => closeSheet(),
      }, icon(r.icon, 20), h('span', {}, r.title)))));
  const mask = h('div.sheet-mask', { onclick: (e) => { if (e.target === mask) closeSheet(); } }, sheet);
  document.getElementById('modal-root').append(mask);
  sheetEl = mask;
  const focusable = sheet.querySelector('a');
  if (focusable) focusable.focus();
}
function closeSheet() {
  if (!sheetEl) return;
  sheetEl.remove();
  sheetEl = null;
}

/* ---------------------------------------------------------------- 起 */
boot();
