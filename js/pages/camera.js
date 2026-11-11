/* 摄像头页：拍照预览 + 跟随/录主人 + 识图问答 + 拍照历史。
   后端没有视频流时这一页就是"拍照预览"，不伪造画面。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, switchEl, toast,
} from '../ui.js';

let unsub = null;
let ctxRef = null;
let el = {};
let qa = [];           // 最近 3 条问答（只在本页内存里）
let shots = [];
let busy = false;

export function page(ctx) {
  ctxRef = ctx;
  qa = [];
  shots = [];
  busy = false;

  /* ---------------- 画面 ---------------- */
  const viewImg = h('img', { alt: '摄像头画面', hidden: true });
  const camBadge = h('div.cam-badge', {}, h('span', {}, 'CAM'));
  const stamp = h('div.cam-stamp', {}, '');
  const placeholder = h('div.cam-placeholder', {},
    h('strong', {}, '拍照预览'),
    h('div', {}, '后端还没有视频流。点「拍一张」，用摄像头抓一帧存到设备上。'));
  const camView = h('div.cam-view', {}, viewImg, placeholder, camBadge, stamp);

  const shotBtn = btn('拍一张', { kind: 'primary', icon: 'camera', onClick: () => snapshot() });
  const lastInfo = h('div.hint-line', {}, '');

  const viewCard = card({ title: '画面', sub: '抓帧存盘，历史在右边' },
    camView,
    h('div.row-between', { style: { marginTop: '10px' } }, lastInfo, shotBtn));

  /* ---------------- 跟随 / 主人 ---------------- */
  const followSwitch = switchEl(false, (on) => setFollow(on), { label: '视觉跟随' });
  const followReason = h('div.hint-line', {}, '');
  const ownerText = h('span.kv-v', {}, DASH);
  const ownerList = h('div.hint-line', {}, '');

  const ownerCard = card({ title: '跟随与主人' },
    h('div.set-row', {},
      h('div', {}, h('div.t', '视觉跟随'), h('div.d', '只跟画面里最大的那个人，没有 re-ID')),
      followSwitch),
    h('div', { style: { marginTop: '4px' } }, followReason),
    h('div.kv', { style: { marginTop: '8px' } }, h('span.kv-k', '当前主人'), ownerText),
    ownerList,
    h('div.row', { style: { marginTop: '10px' } }, btn('录入主人', { icon: 'plus', onClick: () => enroll() })));

  /* ---------------- 识图问答 ---------------- */
  const question = h('input.input', {
    placeholder: '问它看到了什么，比如「桌上有什么」',
    'aria-label': '识图问题',
    onkeydown: (e) => { if (e.key === 'Enter') ask(); },
  });
  const qaList = h('div.qa-list', {});
  const askCard = card({ title: '识图问答', sub: '会先拍一张，再问模型' },
    h('div.row', {}, question, btn('问', { kind: 'primary', icon: 'send', onClick: () => ask() })),
    h('div', { style: { marginTop: '10px' } }, qaList));

  /* ---------------- 历史 ---------------- */
  const shotGrid = h('div.shot-grid', {});
  const shotCount = h('span.card-sub', {}, '');
  const shotsCard = card({ title: '拍照历史', actions: [shotCount] }, shotGrid,
    h('div.hint-line', { style: { marginTop: '8px' } }, '只留最近 50 张，旧照片会被自动删掉。'));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '摄像头'),
        h('div.page-desc', '拍照、认人、识图问答。没有视频流也能用——每次拍一帧。')),
      h('div.page-head-actions', {}, btn('刷新历史', { icon: 'refresh', onClick: () => loadShots() }))),
    h('div.cam-layout', {},
      h('div.stack', {}, viewCard),
      h('div.stack', {}, ownerCard, askCard, shotsCard)));

  el = {
    viewImg, placeholder, camBadge, stamp, shotBtn, lastInfo,
    followSwitch, followReason, ownerText, ownerList, question, qaList,
    shotGrid, shotCount,
  };
  renderQa();
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
  loadShots();
}

export function unmount() {
  if (unsub) unsub();
  unsub = null;
  ctxRef = null;
  el = {};
  qa = [];
  shots = [];
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const v = st.vision || {};
  const online = v.camera === 'online';

  el.camBadge.replaceChildren(
    icon('camera', 12),
    h('span', { class: online ? 'ok' : 'bad', style: { color: online ? '#4FE3B7' : '#FF8A8E' } },
      online ? 'CAM 就绪' : 'CAM 离线'));
  el.followSwitch.setAttribute('aria-checked', v.following ? 'true' : 'false');
  el.followSwitch.disabled = !ctx.link.online;
  el.followReason.textContent = v.follow_reason || (v.follow_target ? `目标：${v.follow_target}` : '');

  el.ownerText.textContent = v.owner || '—（还没录）';
  const owners = v.owners || [];
  el.ownerList.textContent = owners.length
    ? `已录 ${owners.length} 人：${owners.join('、')}${v.weak ? '（其中有人用的是弱特征，换衣服会失效）' : ''}`
    : '没录过主人，跟随只能跟"画面里最大的人"。';

  if (v.camera_reason) el.lastInfo.textContent = v.camera_reason;
  else if (v.last_shot) el.lastInfo.textContent = `最近一张：${v.last_shot}`;
  else el.lastInfo.textContent = online ? '摄像头就绪，可以拍' : '摄像头没就绪';

  el.shotBtn.disabled = busy || !ctx.link.online;
  el.shotCount.textContent = v.shots === undefined ? '' : `${v.shots} 张`;
}

/* ---------------------------------------------------------------- 拍照 */
async function snapshot() {
  const ctx = ctxRef;
  if (!ctx || busy) return;
  busy = true;
  el.shotBtn.disabled = true;
  el.shotBtn.replaceChildren(h('span.spin'), h('span', {}, '拍…'));
  try {
    const res = await ctx.run('vision.op', { op: 'snapshot' }, { timeout: 20000 });
    showShot(res?.url, res?.name);
    ctx.toast(`拍好了：${res?.name || ''}`, 'ok', 2400);
    loadShots();
  } catch { /* 已提示 */ } finally {
    busy = false;
    el.shotBtn.replaceChildren(icon('camera', 15), h('span', {}, '拍一张'));
    if (ctxRef) paint(ctxRef);
  }
}

function showShot(url, name) {
  if (!url) return;
  el.viewImg.src = `${url}?t=${Date.now()}`;
  el.viewImg.hidden = false;
  el.placeholder.style.display = 'none';
  el.stamp.textContent = name ? `${name} · ${fmt.clock(Date.now() / 1000)}` : fmt.clock(Date.now() / 1000);
}

async function loadShots() {
  const ctx = ctxRef;
  if (!ctx || !ctx.link.online) return;
  try {
    const res = await ctx.cmd('vision.op', { op: 'shots', n: 9 });
    shots = res?.items || [];
    renderShots();
  } catch {
    shots = [];
    renderShots();
  }
}

function renderShots() {
  if (!el.shotGrid) return;
  if (!shots.length) {
    el.shotGrid.replaceChildren();
    el.shotGrid.append(h('div.hint-line', { style: { gridColumn: '1 / -1' } },
      ctxRef && ctxRef.link.online ? '还没拍过。点「拍一张」。' : '连接断了，读不到历史。'));
    return;
  }
  el.shotGrid.replaceChildren(...shots.map((s) => h('button', {
    class: 'shot', type: 'button', title: s.name,
    onclick: () => {
      showShot(s.url, s.name);
      if (el.viewImg) el.viewImg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  }, h('img', { src: s.url, alt: s.name, loading: 'lazy' }), h('span.nm', s.name))));
}

/* ---------------------------------------------------------------- 跟随 / 主人 */
async function setFollow(on) {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    const res = await ctx.run('vision.op', { op: 'follow', on });
    if (res && res.ok === false) toast(res.error || '跟随没打开', 'warn');
    else toast(on ? '开始跟随（只跟最大的那个人）' : (res?.reason || '已停止跟随'), 'ok');
  } catch { /* 已提示 */ }
}

async function enroll() {
  const ctx = ctxRef;
  if (!ctx) return;
  const name = await ctx.ask({
    title: '录入主人',
    label: '叫什么名字',
    placeholder: '比如 小林',
    hint: '会让摄像头拍一张，正对镜头、别背光。名字只用字母数字和中文。',
  });
  if (!name) return;
  try {
    const res = await ctx.run('vision.op', { op: 'enroll', name }, { timeout: 25000 });
    if (res && res.ok === false) {
      toast(res.why || res.error || '录入失败', 'error', 6000);
      return;
    }
    if (res?.weak) {
      toast(res.why || '录进去了，但只有弱特征（换衣服会失效）', 'warn', 7000);
    } else {
      toast(`已录入 ${name}`, 'ok');
    }
    loadShots();
  } catch { /* 已提示 */ }
}

/* ---------------------------------------------------------------- 问答 */
async function ask() {
  const ctx = ctxRef;
  if (!ctx) return;
  const q = (el.question?.value || '').trim();
  if (!q) { el.question?.focus(); return; }
  el.question.value = '';
  const item = { q, a: '识别中…', ts: Date.now() / 1000, pending: true };
  qa = [item, ...qa].slice(0, 3);
  renderQa();
  try {
    const res = await ctx.run('vision.op', { op: 'ask', question: q }, { timeout: 60000 });
    if (res && res.ok === false) {
      item.a = res.error || res.why || '模型没给答案';
      item.bad = true;
    } else {
      item.a = res?.answer || res?.text || res?.reply || '（模型返回了空内容）';
    }
    item.pending = false;
    if (res?.url) showShot(res.url, res.shot);
  } catch (err) {
    item.a = err.message || '出错了';
    item.bad = true;
    item.pending = false;
  }
  renderQa();
  loadShots();
}

function renderQa() {
  if (!el.qaList) return;
  if (!qa.length) {
    el.qaList.replaceChildren(h('div.hint-line', {}, '问过的问题会留最近 3 条。'));
    return;
  }
  el.qaList.replaceChildren(...qa.map((it) => h('div.qa-item', {},
    h('div.qa-q', {}, it.q),
    h('div.qa-a', { class: it.bad ? 'qa-a' : '', style: it.bad ? { color: 'var(--danger-ink)' } : null }, it.a),
    h('div.qa-meta', {}, fmt.clock(it.ts)))));
}
