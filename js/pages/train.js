/* 训练页：录制 → 回放 → 导出 .zdm → 外部训练 → 导入策略 → 换槽位。
   浏览器没有上传通道，导入走"设备上的路径"（后端只接受 uploads/ 或临时目录）。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, toast, copyText,
} from '../ui.js';

const SLOT_CN = {
  walk: '走路', sitstand: '坐下站起', ground_pick: '地上捡东西',
  kick_left: '左脚踢球', kick_right: '右脚踢球', roulade: '前滚翻', stand: '站好（兜底）',
};

let unsub = null;
let ctxRef = null;
let el = {};
let importPath = null;
let droppedFiles = [];

export function page(ctx) {
  ctxRef = ctx;
  droppedFiles = [];

  /* ---------------- 录制 ---------------- */
  const recDot = h('div.rec-dot');
  const timer = h('div.rec-timer', {}, '0.0 s');
  const frames = h('span.rec-stat', {}, '0 帧');
  const missing = h('span.rec-stat', {}, '');
  const recBtn = btn('开始录制', { kind: 'primary', icon: 'record', onClick: () => toggleRec() });
  const recBar = h('div.rec-bar', {},
    recDot,
    h('div.grow', {}, timer, h('div', { style: { display: 'flex', gap: '10px' } }, frames, missing)),
    recBtn);

  const jobBox = h('div', { style: { marginTop: '10px' } });
  const recCard = card({ title: '录制', sub: '15 维关节角 @ 50 Hz，缺一颗就不让录' },
    recBar,
    h('div.hint-line', { style: { marginTop: '8px' } },
      '录完先回放看一眼，再导出 .zdm。空录进去的动作，训练出来也是废的。'),
    jobBox);

  /* ---------------- 会话 ---------------- */
  const sessionList = h('div.session-list', {});
  const sessionCard = card({
    title: '会话',
    sub: '最近 50 段',
    actions: [btn('刷新', { size: 'sm', icon: 'refresh', onClick: () => refreshSessions() })],
  }, sessionList);

  /* ---------------- 槽位 ---------------- */
  const slotTable = h('table.table', {},
    h('thead', {}, h('tr', {},
      h('th', '槽位'), h('th', '当前模型'), h('th', '状态'), h('th', { style: { textAlign: 'right' } }, '操作'))),
    h('tbody'));
  const slotCard = card({ title: '策略槽位', sub: '内置槽位删不掉，只能换模型' }, slotTable);

  /* ---------------- 导入 ---------------- */
  const pathInput = h('input.input.mono', {
    placeholder: '设备上的目录，里面有 policy.onnx + policy.json',
    'aria-label': '策略目录路径',
  });
  importPath = pathInput;
  const dropzone = h('div.dropzone', {
    tabindex: '0',
    role: 'button',
    'aria-label': '拖入策略文件',
    onclick: () => pathInput.focus(),
    onkeydown: (e) => { if (e.key === 'Enter') pathInput.focus(); },
  },
  h('strong', {}, '把 policy.onnx + policy.json 拖到这里'),
  h('div', {}, '或者直接在下面填设备上的目录路径。'));

  const dropNote = h('div.hint-line', {});
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    droppedFiles = files.map((f) => ({ name: f.name, size: f.size }));
    renderDropNote();
  });

  const importBtn = btn('导入', { kind: 'primary', icon: 'upload', onClick: () => doImport() });
  const importCard = card({ title: '导入策略', sub: '.onnx + 同名 .json' },
    dropzone, h('div', { style: { marginTop: '10px' } }, h('div.row', {}, pathInput, importBtn)),
    dropNote,
    h('div.note', { style: { marginTop: '10px' } }, icon('info', 15),
      h('div', {}, '浏览器不能直接把文件写到板子上：先把两个文件拷到设备的 state_dir/uploads/ 里（SSH 或 U 盘），再把目录路径填在上面。')));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', '训练'),
        h('div.page-desc', '在这里录动作、回放、打包；训练在电脑上做，再把 ONNX 导回来换槽位。')),
      h('div.page-head-actions', {}, h('span', { id: 'train-chips' }))),
    recCard,
    h('div.grid-2', {}, sessionCard, slotCard),
    importCard);

  el = { recDot, timer, frames, missing, recBtn, jobBox, sessionList, slotTable, chips: pageEl.querySelector('#train-chips'), dropzone, dropNote };
  renderDropNote();
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
  importPath = null;
  droppedFiles = [];
}

/* ---------------------------------------------------------------- 状态 */
let lastSessions = '';
let lastSlots = '';

function paint(ctx) {
  const st = ctx.state() || {};
  const tr = st.train || {};
  const recording = Boolean(tr.recording);

  el.recDot.parentElement?.classList.toggle('is-rec', recording);
  el.timer.textContent = recording
    ? `${fmt.n(tr.duration_s, 1)} s`
    : (tr.duration_s ? `${fmt.n(tr.duration_s, 1)} s（上一段）` : '0.0 s');
  el.frames.textContent = `${fmt.int(tr.frames || 0)} 帧 · ${fmt.int(tr.hz || 50)} Hz`;
  el.missing.textContent = tr.missing_samples ? `缺 ${tr.missing_samples} 帧` : '';
  el.missing.style.color = tr.missing_samples ? 'var(--warn-ink)' : '';

  el.recBtn.replaceChildren(
    icon(recording ? 'x' : 'record', 15),
    h('span', {}, recording ? '停止并保存' : '开始录制'));
  el.recBtn.className = `btn ${recording ? 'btn-danger' : 'btn-primary'}`;
  el.recBtn.disabled = !ctx.link.online || Boolean(tr.busy && !recording);

  // 任务进度
  const job = tr.job;
  if (job && (tr.busy || job.phase === 'error')) {
    const pct = Math.max(0, Math.min(1, Number(job.progress) || 0));
    el.jobBox.replaceChildren(h('div', {},
      h('div.row-between', {},
        h('span.hint-line', {}, `${job.kind === 'import' ? '导入' : job.kind === 'export' ? '打包' : '回放'} · ${job.phase || ''}${job.session ? ` · ${job.session}` : ''}`),
        h('span.mono.hint-line', {}, `${Math.round(pct * 100)}%`)),
      h('div.bar', { style: { marginTop: '4px' } }, h('i', { style: { width: `${pct * 100}%` } })),
      job.error ? h('div.note.note-danger', { style: { marginTop: '8px' } }, icon('alert', 15), h('div', {}, job.error)) : null));
  } else {
    el.jobBox.replaceChildren();
  }

  // 会话
  const sessions = tr.sessions || [];
  const sig = sessions.map((s) => `${s.session}:${s.frames}:${s.packed}`).join('|');
  if (sig !== lastSessions) {
    lastSessions = sig;
    renderSessions(sessions);
  }

  // 槽位
  const slots = tr.slots || [];
  const models = tr.models || [];
  const sig2 = slots.map((s) => `${s.slot}:${s.model}:${s.running}`).join('|') + `#${models.length}`;
  if (sig2 !== lastSlots) {
    lastSlots = sig2;
    renderSlots(slots, models);
  }

  el.chips.replaceChildren(
    chip(tr.onnxruntime ? 'onnxruntime 就绪' : '没有 onnxruntime', tr.onnxruntime ? 'ok' : 'warn'),
    recording ? chip('录制中', 'danger') : chip('待机'),
    tr.running ? chip(`运行中：${SLOT_CN[tr.running] || tr.running}`, 'ok') : chip('没有运行中的策略'),
  );
}

function renderSessions(sessions) {
  if (!sessions.length) {
    el.sessionList.replaceChildren(h('div.empty', {},
      h('strong', {}, '还没有录制'),
      h('p', {}, '点上面的「开始录制」，手动摆几个动作，再停止。')));
    return;
  }
  el.sessionList.replaceChildren(...sessions.slice(0, 12).map((s) => h('div.session-row', {},
    h('span.n', { title: s.session }, s.session),
    h('span.m', {}, s.duration_s ? fmt.dur(s.duration_s) : DASH),
    h('span.m', {}, `${fmt.int(s.frames)} 帧`),
    s.complete ? null : chip('没正常结束', 'warn'),
    s.packed ? chip('已打包', 'ok') : null,
    h('div.acts', {},
      btn('回放', { size: 'sm', onClick: () => replay(s.session) }),
      btn('导出 .zdm', { size: 'sm', kind: 'outline', onClick: () => exportSession(s.session) })))));
}

function renderSlots(slots, models) {
  const tbody = el.slotTable.querySelector('tbody');
  if (!slots.length) {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '4' }, h('div.empty', {}, h('strong', {}, '读不到槽位'), h('p', {}, '等状态上报。')))));
    return;
  }
  tbody.replaceChildren(...slots.map((s) => {
    const options = models.length
      ? models.map((m) => ({ value: m.id, label: `${m.name || m.id}${m.builtin ? '（内置）' : ''}` }))
      : [{ value: s.model || '', label: s.model_name || s.model || '（空）' }];
    const sel = h('select', { class: 'select', 'aria-label': `${SLOT_CN[s.slot] || s.slot} 的模型` },
      ...options.map((o) => {
        const opt = h('option', { value: o.value }, o.label);
        if (o.value === s.model) opt.selected = true;
        return opt;
      }));
    sel.addEventListener('change', () => setSlot(s.slot, sel.value));
    return h('tr', {},
      h('td', {}, h('div.nm', {}, SLOT_CN[s.slot] || s.slot), h('div.skill-id', {}, s.slot)),
      h('td', {}, h('div.row', { style: { gap: '6px' } }, sel)),
      h('td', {}, h('div.slot-st', {},
        s.running ? chip('运行中', 'ok') : chip(s.model ? '已装载' : '空', s.model ? '' : 'warn'),
        s.builtin ? chip('内置', 'mute') : null)),
      h('td', { style: { textAlign: 'right' } },
        btn('清除', {
          size: 'sm', kind: 'ghost',
          onClick: () => clearSlot(s.slot),
        })));
  }));
}

function renderDropNote() {
  if (!el.dropNote) return;
  if (!droppedFiles.length) {
    el.dropNote.textContent = '';
    return;
  }
  const names = droppedFiles.map((f) => `${f.name}（${Math.max(1, Math.round(f.size / 1024))} KB）`).join('、');
  el.dropNote.textContent = `选好了：${names}。浏览器拿不到它们的真实路径——把它们拷进设备再填目录路径。`;
  el.dropNote.style.color = 'var(--warn-ink)';
}

/* ---------------------------------------------------------------- 动作 */
async function toggleRec() {
  const ctx = ctxRef;
  if (!ctx) return;
  const tr = ctx.state()?.train || {};
  if (tr.recording) {
    try {
      const res = await ctx.run('train.op', { op: 'stop' }, { timeout: 30000 });
      toast(`已保存 ${res?.session || ''}（${res?.frames ?? '—'} 帧）`, 'ok', 4200);
    } catch { /* 已提示 */ }
    return;
  }
  try {
    const res = await ctx.run('train.op', { op: 'record' }, { timeout: 15000 });
    toast(`开始录制 ${res?.session || ''}`, 'ok', 2600);
  } catch { /* 已提示 */ }
}

async function replay(session) {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    await ctx.run('train.op', { op: 'replay', session }, { timeout: 30000 });
    toast(`回放 ${session}`, 'ok');
  } catch { /* 已提示 */ }
}

async function exportSession(session) {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    const res = await ctx.run('train.op', { op: 'export', session }, { timeout: 60000 });
    const path = res?.path || '';
    toast(`已打包 ${res?.file || ''}（${Math.round((res?.bytes || 0) / 1024)} KB）`, 'ok', 6000);
    if (path) {
      const ok = await ctx.confirm({
        title: '动作包已生成',
        body: h('div.stack-8', {},
          h('div.mono', { style: { wordBreak: 'break-all', fontSize: '12px' } }, path),
          h('div.hint-line', {}, `内容：${(res?.contents || []).join('、')}`)),
        okText: '复制路径',
        cancelText: '关掉',
      });
      if (ok) {
        const copied = await copyText(path);
        toast(copied ? '路径已复制' : '复制失败，手动选一下', copied ? 'ok' : 'warn');
      }
    }
  } catch { /* 已提示 */ }
}

async function setSlot(slot, modelId) {
  const ctx = ctxRef;
  if (!ctx || !modelId) return;
  try {
    const res = await ctx.run('train.op', { op: 'slot', action: 'set', slot, model_id: modelId });
    toast(`${SLOT_CN[slot] || slot} → ${res?.model_name || modelId}`, 'ok', 2600);
  } catch { /* 已提示 */ }
}

async function clearSlot(slot) {
  const ctx = ctxRef;
  if (!ctx) return;
  const ok = await ctx.confirm({
    title: `清除 ${SLOT_CN[slot] || slot}`,
    message: '内置槽位删不掉，会换回内置策略；自己导入的模型文件不会删。',
    okText: '清除',
  });
  if (!ok) return;
  try {
    const res = await ctx.run('train.op', { op: 'slot', action: 'clear', slot });
    toast(res?.note || '已清除', 'ok', 4200);
  } catch { /* 已提示 */ }
}

async function refreshSessions() {
  if (!ctxRef) return;
  try {
    const res = await ctxRef.cmd('train.op', { op: 'sessions' });
    lastSessions = '';
    paint(ctxRef);
    if (!res?.sessions?.length) toast('还没有录制', 'warn');
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
}

async function doImport() {
  const ctx = ctxRef;
  if (!ctx) return;
  const path = (importPath?.value || '').trim();
  if (!path) {
    toast('先填设备上的目录路径', 'warn');
    importPath?.focus();
    return;
  }
  try {
    const res = await ctx.run('train.op', { op: 'import', path }, { timeout: 90000 });
    toast(`已导入 ${res?.model_id || ''}${res?.reused ? '（复用已有）' : ''}`, 'ok', 5000);
    droppedFiles = [];
    renderDropNote();
    if (importPath) importPath.value = '';
  } catch { /* 已提示 */ }
}
