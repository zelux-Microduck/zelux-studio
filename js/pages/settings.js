/* 设置页：设备信息、口令、WiFi、升级、诊断、电源。
   后端没开放的能力（WiFi 连接、OTA）不假装成功：给出明确原因和可复制的命令。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, toast, copyText, askDialog,
} from '../ui.js';
let unsub = null;
let ctxRef = null;
let el = {};
let diagLoaded = false;

export function page(ctx) {
  ctxRef = ctx;
  diagLoaded = false;

  /* ---------------- 设备 ---------------- */
  const devName = h('span.kv-v', {}, DASH);
  const devHost = h('span.kv-v.mono', {}, DASH);
  const devIp = h('span.kv-v.mono', {}, DASH);
  const urlBox = h('div.stack-8', {});
  const devCard = card({ title: '设备', sub: '名字来自主机名（hostname）' },
    h('div.kv', {}, h('span.kv-k', '设备名'), devName),
    h('div.kv', {}, h('span.kv-k', '主机名'), devHost),
    h('div.kv', {}, h('span.kv-k', '局域网 IP'), devIp),
    h('div.subhead', { style: { marginTop: '10px' } }, '访问地址'),
    urlBox,
    h('div.hint-line', { style: { marginTop: '8px' } },
      '改设备名要用 hostnamectl（后端没开这个口子）：sudo hostnamectl set-hostname 新名字'));

  /* ---------------- 口令 ---------------- */
  const oldPw = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: '当前口令', 'aria-label': '当前口令' });
  const newPw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: '新口令（至少 4 位）', 'aria-label': '新口令' });
  const pwBtn = btn('改口令', { onClick: () => changePassword() });
  const pwResult = h('div.hint-line', {});
  const pwCard = card({ title: '口令', sub: '改完会签发新会话，其他页面要重新登录' },
    h('div.stack-8', {}, oldPw, newPw, h('div.row', {}, pwBtn, pwResult)));

  /* ---------------- WiFi ---------------- */
  const wifiList = h('div.wifi-list', {});
  const wifiBtn = btn('扫描', { icon: 'wifi', onClick: () => scanWifi() });
  const wifiNote = h('div.hint-line', {}, '');
  const wifiCard = card({ title: 'WiFi', actions: [wifiBtn] }, wifiList, wifiNote);

  /* ---------------- 升级 ---------------- */
  const verText = h('span.kv-v.mono', {}, DASH);
  const stagedText = h('span.kv-v', {}, DASH);
  const otaResult = h('div.hint-line', {});
  const otaCard = card({ title: '升级', sub: '版本目录 + staged 候选 + 回滚' },
    h('div.kv', {}, h('span.kv-k', '当前版本'), verText),
    h('div.kv', {}, h('span.kv-k', '已下载待安装'), stagedText),
    h('div.row.wrap', { style: { marginTop: '10px' } },
      btn('检查更新', { onClick: () => ota('check') }),
      btn('安装', { kind: 'primary', onClick: () => ota('apply') }),
      btn('回滚', { kind: 'outline', onClick: () => ota('rollback') })),
    otaResult,
    h('div.note', { style: { marginTop: '10px' } }, icon('info', 15),
      h('div', {}, '升级前必须 posture=holding 且策略关闭，否则后端会拒绝并说明原因。这一版后端如果没装 ota 模块，按钮会直接报"没有 ota 这个模块"。')));

  /* ---------------- 诊断 ---------------- */
  const diagPre = h('pre.diag-pre', {}, '点「读取诊断」拉一份设备现状。');
  const diagBtn = btn('读取诊断', { icon: 'refresh', onClick: () => loadDiag() });
  const diagCopy = btn('复制', { icon: 'copy', onClick: () => copyDiag() });
  const diagCard = card({ title: '诊断', sub: '/api/diag 原文' },
    h('div.row', { style: { marginBottom: '8px' } }, diagBtn, diagCopy), diagPre);

  /* ---------------- 电源 ---------------- */
  const powerCard = card({ title: '电源与登录' },
    h('div.set-row', {},
      h('div', {}, h('div.t', '重启主控'), h('div.d', '舵机保持当前姿势，不断电；约 40 秒回来。')),
      btn('重启', { kind: 'warn', onClick: () => power('reboot') })),
    h('div.set-row', {},
      h('div', {}, h('div.t', '关机'), h('div.d', '先让它坐下或扶着它——断电会直接趴下。')),
      btn('关机', { kind: 'danger', onClick: () => power('poweroff') })),
    h('div.set-row', {},
      h('div', {}, h('div.t', '退出登录'), h('div.d', '清掉这台浏览器上的会话 cookie。')),
      btn('退出', { onClick: () => ctx.logout() })));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '设置'),
        h('div.page-desc', '名字、口令、网络、升级、诊断。改硬件参数请去舵机页。')),
      h('div.page-head-actions', {}, btn('外观与 MicroDuck', { icon: 'duck', onClick: () => ctx.go('/microduck') }), h('span', { id: 'set-chips' }))),
    h('div.set-grid', {}, devCard, pwCard, wifiCard, otaCard, diagCard, powerCard));

  el = { devName, devHost, devIp, urlBox, oldPw, newPw, pwResult, wifiList, wifiBtn, wifiNote, verText, stagedText, otaResult, diagPre, chips: pageEl.querySelector('#set-chips') };
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
  scanWifi(true);
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  ctxRef = null;
  el = {};
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const hlo = ctx.store.get('hello');
  const net = st.net || {};
  const name = net.host || get(hlo, 'duck.label') || 'zelux-duck';
  el.devName.textContent = name;
  el.devHost.textContent = net.host || DASH;
  el.devIp.textContent = net.ip || DASH;

  const urls = Array.isArray(net.urls) && net.urls.length
    ? net.urls
    : net.ip ? [{ url: `http://${net.ip}:8000`, kind: 'lan' }] : [];
  el.urlBox.replaceChildren(...(urls.length
    ? urls.map((u) => h('div.row-between', {},
      h('span.mono', { style: { fontSize: '12px' } }, u.url),
      h('div.row', { style: { gap: '4px' } }, chip(u.kind || 'lan'),
        btn('复制', { size: 'sm', kind: 'ghost', icon: 'copy', onClick: async () => {
          const ok = await copyText(u.url);
          toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'warn', 1600);
        } }))))
    : [h('div.hint-line', {}, '还没有网络地址：接上 WiFi 或网线。')]));

  const version = get(st, 'sys.version') || get(hlo, 'version') || '—';
  el.verText.textContent = version;
  const staged = get(st, 'ota.staged');
  el.stagedText.textContent = staged || '没有';
  el.chips.replaceChildren(
    chip(`后端 ${version}`),
    chip(get(st, 'sys.backend') === 'radxa' ? '真机' : '模拟'),
    get(st, 'ota.busy') ? chip('升级进行中', 'warn') : null,
    chip(ctx.link.online ? '在线' : '离线', ctx.link.online ? 'ok' : 'danger'),
  );
}

/* ---------------------------------------------------------------- 口令 */
async function changePassword() {
  const ctx = ctxRef;
  if (!ctx) return;
  const oldVal = el.oldPw.value;
  const newVal = el.newPw.value;
  if (newVal.length < 4) { el.pwResult.textContent = '新口令至少 4 位'; return; }
  el.pwResult.textContent = '';
  try {
    const res = await fetch('/api/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': ctx.session()?.csrf || '' },
      body: JSON.stringify({ old: oldVal, new: newVal }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      ctx.setCsrf?.(data.csrf);
      el.oldPw.value = '';
      el.newPw.value = '';
      el.pwResult.textContent = '已改。其他设备上的页面要重新登录。';
      el.pwResult.style.color = 'var(--brand-ink)';
      toast('口令已修改', 'ok');
    } else {
      el.pwResult.textContent = data.error || `改不成（HTTP ${res.status}）`;
      el.pwResult.style.color = 'var(--danger-ink)';
    }
  } catch (err) {
    el.pwResult.textContent = `连不上设备：${err.message || err}`;
    el.pwResult.style.color = 'var(--danger-ink)';
  }
}

/* ---------------------------------------------------------------- WiFi */
async function scanWifi(silent = false) {
  const ctx = ctxRef;
  if (!ctx) return;
  if (!silent) el.wifiBtn?.setAttribute('disabled', '');
  try {
    const res = await ctx.cmd('sys.op', { op: 'wifi_scan' }, { timeout: 20000 });
    const nets = res?.networks || [];
    renderWifi(nets);
    if (!silent && !nets.length) toast('没扫到网络：这台机器没有 nmcli，或无线网卡没起来', 'warn', 5000);
  } catch (err) {
    el.wifiNote.textContent = err.message || String(err);
    el.wifiNote.style.color = 'var(--danger-ink)';
  } finally {
    el.wifiBtn?.removeAttribute('disabled');
  }
}

function renderWifi(nets) {
  if (!nets.length) {
    el.wifiList.replaceChildren(h('div.empty', {},
      h('strong', {}, '没扫到 WiFi'),
      h('p', {}, '可能是没有 nmcli、没插无线网卡，或者正在连有线。')));
    return;
  }
  el.wifiList.replaceChildren(...nets.map((n) => h('button', {
    class: 'wifi-item', type: 'button',
    onclick: () => connectWifi(n),
  },
  icon('wifi', 15),
  h('span.ssid', {}, n.ssid),
  n.security && n.security !== 'open' && n.security !== '--' ? icon('lock', 12) : null,
  h('span.sig', {}, `${n.signal ?? '—'}%`))));
  el.wifiNote.textContent = '点一个网络：这一版后端只开放扫描，连接会给你一条 nmcli 命令去设备上执行。';
}

async function connectWifi(net) {
  const ctx = ctxRef;
  if (!ctx) return;
  const secured = net.security && net.security !== 'open' && net.security !== '--';
  const pw = secured ? await askDialog({
    title: `连接 ${net.ssid}`,
    label: 'WiFi 密码',
    hint: '密码只写进这条命令里，不会发给后端（后端没有开放连接接口）。',
    mono: true,
    okText: '生成命令',
  }) : '';
  if (secured && pw === null) return;
  const cmd = secured
    ? `nmcli dev wifi connect "${net.ssid}" password "${pw || '<密码>'}"`
    : `nmcli dev wifi connect "${net.ssid}"`;
  const ok = await ctx.confirm({
    title: '在设备上执行这条命令',
    sub: net.ssid,
    body: h('div.stack-8', {},
      h('div.mono', { style: { fontSize: '12px', background: 'var(--panel-3)', padding: '8px', borderRadius: '6px', wordBreak: 'break-all' } }, cmd),
      h('div.hint-line', {}, 'SSH 进设备，或接 HDMI 键盘，执行完回这一页点「扫描」看是否连上。')),
    okText: '复制命令',
    cancelText: '关掉',
  });
  if (!ok) return;
  const copied = await copyText(cmd);
  toast(copied ? '命令已复制' : '复制失败，手动选一下', copied ? 'ok' : 'warn');
}

/* ---------------------------------------------------------------- 升级 */
async function ota(op) {
  const ctx = ctxRef;
  if (!ctx) return;
  if (op === 'apply') {
    const ok = await ctx.confirm({
      title: '安装已下载的版本',
      message: '要求：鸭子站着（holding）且策略关闭。不满足后端会拒绝并说明原因。',
      okText: '安装',
    });
    if (!ok) return;
  }
  if (op === 'rollback') {
    const ok = await ctx.confirm({
      title: '回滚到上一个版本',
      message: '回滚会重启服务，页面会短暂断开。',
      okText: '回滚',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const res = await ctx.run('ota.op', { op }, { timeout: 60000 });
    el.otaResult.textContent = JSON.stringify(res).slice(0, 300);
    el.otaResult.style.color = 'var(--ink-3)';
  } catch (err) {
    el.otaResult.textContent = err.message || String(err);
    el.otaResult.style.color = 'var(--danger-ink)';
  }
}

/* ---------------------------------------------------------------- 诊断 */
async function loadDiag() {
  const ctx = ctxRef;
  if (!ctx) return;
  el.diagPre.textContent = '读取中…';
  try {
    const res = await fetch('/api/diag', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      el.diagPre.textContent = `读不到诊断（HTTP ${res.status}）：${data.error || '会话可能过期了'}`;
      return;
    }
    diagLoaded = true;
    el.diagPre.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    el.diagPre.textContent = `连不上设备：${err.message || err}`;
  }
}

async function copyDiag() {
  if (!diagLoaded) { await loadDiag(); }
  const text = el.diagPre.textContent || '';
  const ok = await copyText(text);
  toast(ok ? '诊断信息已复制' : '复制失败，手动选中复制', ok ? 'ok' : 'warn');
}

/* ---------------------------------------------------------------- 电源 */
async function power(what) {
  const ctx = ctxRef;
  if (!ctx) return;
  const isReboot = what === 'reboot';
  const ok = await ctx.confirm({
    title: isReboot ? '重启主控' : '关机',
    message: isReboot
      ? '舵机会保持当前姿势，不断电；页面会断开约 40 秒。'
      : '断电后舵机立刻卸力，鸭子会趴下——先让它坐下，或扶着它。',
    okText: isReboot ? '重启' : '关机',
    danger: !isReboot,
  });
  if (!ok) return;
  try {
    const res = await ctx.run('sys.op', { op: what, confirm: true }, { timeout: 15000 });
    toast(res?.note || (isReboot ? '正在重启…' : '正在关机…'), 'ok', 6000);
  } catch { /* 已提示 */ }
}
