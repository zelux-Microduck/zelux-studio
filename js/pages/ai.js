/* AI 页：语音（按住说话）+ 对话流 + 技能库 + 模型配置。
   语音状态机只用后端上报的 listening/speaking，不自己编"正在识别"。 */

import {
  h, icon, btn, card, chip, fmt, get, DASH, switchEl, toast,
} from '../ui.js';

const STATE_SAY = {
  idle: '空闲',
  listening: '在听',
  thinking: '在想',
  speaking: '在说',
};

let unsub = null;
let unsubEvent = null;
let ctxRef = null;
let el = {};
let messages = [];
let skills = [];
let thinking = false;
let holding = false;
let streamingNode = null;
let replyMark = 0;
let cfgLoaded = false;

export function page(ctx) {
  ctxRef = ctx;
  messages = [];
  skills = [];
  thinking = false;
  holding = false;
  streamingNode = null;
  replyMark = 0;
  cfgLoaded = false;

  /* ---------------- 语音 ---------------- */
  const micBtn = h('button', {
    class: 'mic-btn', type: 'button', 'data-state': 'idle',
    'aria-label': '按住说话', title: '按住说话，松开发送',
  }, icon('mic', 34));
  const micState = h('div.mic-state', {}, '空闲');
  const micHint = h('div.mic-hint', {}, '按住说话，松开发送。没有麦克风就打字。');
  const latChip = h('span', {}, '');

  const voiceCard = card({ title: '语音', sub: '端到端目标 < 2 s' },
    h('div.mic-zone', {}, micBtn, micState, micHint),
    h('div.row-between', { style: { marginTop: '10px' } },
      h('span.hint-line', {}, '唤醒 / ASR / TTS 能力由后端探测'),
      latChip));

  bindMic(micBtn);

  /* ---------------- 对话 ---------------- */
  const chat = h('div.chat', { role: 'log', 'aria-live': 'polite' });
  const chatInput = h('input.input', {
    placeholder: '打字问它，比如「现在电量多少」',
    'aria-label': '输入对话内容',
    onkeydown: (e) => { if (e.key === 'Enter') sendChat(); },
  });
  const chatCard = card({ title: '对话', sub: '技能优先，命中就不走大模型' },
    chat,
    h('div.row', { style: { marginTop: '10px' } }, chatInput,
      btn('发送', { kind: 'primary', icon: 'send', onClick: () => sendChat() })));

  /* ---------------- 技能 ---------------- */
  const skillGrid = h('div.skills-grid', {});
  const skillNote = h('div.hint-line', {});
  const skillCard = card({
    title: '技能库',
    sub: '命中就本地执行，0 次大模型往返',
    actions: [btn('安装技能', { icon: 'upload', onClick: () => installSkill() })],
  }, skillNote, skillGrid);

  /* ---------------- 模型 ---------------- */
  const baseUrl = h('input.input.mono', { placeholder: 'https://api.example.com/v1', 'aria-label': 'base_url' });
  const modelName = h('input.input.mono', { placeholder: '模型名，比如 doubao-seed', 'aria-label': '模型名' });
  const apiKey = h('input.input.mono', { type: 'password', placeholder: '留空表示不改', 'aria-label': 'API Key' });
  const provider = h('input.input.mono', { placeholder: 'openai_compatible', 'aria-label': '提供方' });
  const keyChip = h('span', {});
  const saveBtn = btn('保存配置', { kind: 'primary', onClick: () => saveCfg() });
  const testBtn = btn('测一下', { icon: 'bolt', onClick: () => testCfg() });
  const cfgResult = h('div.hint-line', {});

  const modelCard = card({ title: '模型配置', sub: 'Key 只显示打码值' },
    h('div.model-form', {},
      h('label.field', {}, h('span.field-label', 'Base URL'), baseUrl),
      h('label.field', {}, h('span.field-label', '模型'), modelName),
      h('label.field.full', {}, h('span.field-label', 'API Key', keyChip), apiKey),
      h('label.field', {}, h('span.field-label', 'Provider'), provider)),
    h('div.row', { style: { marginTop: '10px' } }, saveBtn, testBtn, cfgResult));

  const pageEl = h('div.page', {},
    h('div.page-head', {},
      h('div', {},
        h('h1.page-title', 'AI 语音'),
        h('div.page-desc', '说话、对话、装技能。技能命中时 0 次大模型往返，端到端更快。')),
      h('div.page-head-actions', {}, h('span', { id: 'ai-chips' }))),
    h('div.ai-layout', {}, h('div.stack', {}, voiceCard), h('div.stack', {}, chatCard)),
    skillCard,
    modelCard);

  el = {
    micBtn, micState, micHint, latChip, chat, chatInput, skillGrid, skillNote,
    baseUrl, modelName, apiKey, provider, keyChip, cfgResult, chips: pageEl.querySelector('#ai-chips'),
    saveBtn, testBtn,
  };

  renderChat();
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  unsubEvent = ctx.link.onEvent((name, data) => onEvent(name, data));
  paint(ctx);
  loadSkills();
  loadConfig();
}

export function unmount() {
  if (unsub) unsub();
  if (unsubEvent) unsubEvent();
  unsub = null;
  unsubEvent = null;
  ctxRef = null;
  el = {};
  messages = [];
  skills = [];
  streamingNode = null;
}

/* ---------------------------------------------------------------- 状态 */
function paint(ctx) {
  const st = ctx.state() || {};
  const ai = st.ai || {};
  let state = 'idle';
  if (ai.speaking) state = 'speaking';
  else if (ai.listening) state = 'listening';
  else if (thinking) state = 'thinking';

  el.micBtn.dataset.state = state;
  el.micState.textContent = STATE_SAY[state] || '空闲';
  el.micBtn.disabled = !ctx.link.online || ai.ready === false;

  const lat = ai.latency_ms;
  const budget = ai.budget_ms || 2000;
  el.latChip.replaceChildren(
    lat == null
      ? chip('时延 —')
      : chip(`${fmt.int(lat)} ms${lat < budget ? ' · 达标' : ' · 超 2 s'}`, lat < budget ? 'ok' : 'warn'));

  el.chips.replaceChildren(
    chip(ai.ready ? '模型就绪' : '没配模型', ai.ready ? 'ok' : 'danger'),
    chip(`${ai.skills ?? 0} 个技能`),
    ai.skills_failed ? chip(`${ai.skills_failed} 个技能坏了`, 'warn') : null,
    chip(`ASR ${ai.asr || '—'}`),
    chip(`TTS ${ai.tts || '—'}`),
  );

  if (ai.ready === false) {
    el.micHint.textContent = '模型还没配：先在下面填 base_url 和 key，就能说话。';
  } else if (state === 'listening') {
    el.micHint.textContent = '在听…松开就发出去。';
  } else if (state === 'thinking') {
    el.micHint.textContent = '在想…';
  } else if (state === 'speaking') {
    el.micHint.textContent = '在说…点「停止」可以打断。';
  } else {
    el.micHint.textContent = '按住说话，松开发送。没有麦克风就打字。';
  }
}

/* ---------------------------------------------------------------- 语音 */
function bindMic(mic) {
  const start = async (e) => {
    e.preventDefault();
    if (!ctxRef || holding) return;
    holding = true;
    mic.setPointerCapture?.(e.pointerId);
    try {
      await ctxRef.run('ai.op', { op: 'listen', on: true });
    } catch {
      holding = false;
    }
  };
  const stop = async () => {
    if (!ctxRef || !holding) return;
    holding = false;
    try {
      await ctxRef.run('ai.op', { op: 'listen', on: false }, { timeout: 30000 });
    } catch { /* 已提示 */ }
  };
  mic.addEventListener('pointerdown', start);
  mic.addEventListener('pointerup', stop);
  mic.addEventListener('pointercancel', stop);
  mic.addEventListener('pointerleave', () => { if (holding) stop(); });
  mic.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (!holding) start(e); else stop();
    }
  });
  mic.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.code === 'Space') stop();
  });
}

/* ---------------------------------------------------------------- 事件 */
function onEvent(name, data) {
  if (!ctxRef) return;
  if (name === 'ai.asr_final') {
    if (data.text) pushMsg('me', data.text);
  } else if (name === 'ai.asr_partial') {
    if (data.text) el.micHint.textContent = `在听：${data.text}`;
  } else if (name === 'ai.delta') {
    thinking = false;
    if (!streamingNode) {
      streamingNode = pushMsg('ai', '', { streaming: true });
    }
    const m = messages[messages.length - 1];
    if (m && m.streaming) {
      m.text += data.text || '';
      if (streamingNode.body) streamingNode.body.textContent = m.text;
    }
  } else if (name === 'ai.reply') {
    thinking = false;
    streamingNode = null;
    if (data.text) {
      const last = messages[messages.length - 1];
      const dup = last && last.role === 'ai' && last.text === data.text && Date.now() - last.at < 2500;
      if (!dup) pushMsg('ai', data.text, { source: data.source, skill: data.skill });
    }
    replyMark = Date.now();
  } else if (name === 'ai.error') {
    thinking = false;
    if (data.error) toast(data.error, 'error', 6000);
  } else if (name === 'ai.wake') {
    toast(`唤醒：${data.label || ''}`, 'ok', 1600);
  } else if (name === 'ai.latency') {
    if (data.total != null) {
      const budget = data.budget || 2000;
      el.latChip.replaceChildren(chip(`${fmt.int(data.total)} ms${data.total < budget ? ' · 达标' : ' · 超 2 s'}`,
        data.total < budget ? 'ok' : 'warn'));
    }
  }
}

/* ---------------------------------------------------------------- 对话 */
function pushMsg(role, text, extra = {}) {
  const msg = { role, text, at: Date.now(), ...extra };
  messages.push(msg);
  if (messages.length > 40) messages.shift();
  renderChat();
  const node = el.chat.lastElementChild;
  el.chat.scrollTop = el.chat.scrollHeight;
  return { msg, body: node ? node.querySelector('.bubble-msg') : null };
}

function renderChat() {
  if (!el.chat) return;
  if (!messages.length) {
    el.chat.replaceChildren(h('div.empty', {},
      h('strong', {}, '还没有对话'),
      h('p', {}, '按住左边的麦克风说话，或者在下面打字。技能命中时会直接执行，不走大模型。')));
    return;
  }
  el.chat.replaceChildren(...messages.map((m) => {
    const body = h('div.bubble-msg', m.text || (m.streaming ? '…' : ''));
    const meta = h('div.bubble-meta', {},
      h('span', {}, fmt.clock(m.at / 1000)),
      m.skill ? h('span', {}, `技能 ${m.skill}`) : null,
      m.role === 'ai' ? h('button', {
        class: 'bubble-play', type: 'button',
        onclick: () => say(m.text),
      }, '播放') : null);
    return h('div', { class: `bubble-row${m.role === 'me' ? ' me' : ''}` },
      h('div', {}, body, meta));
  }));
  if (thinking) {
    el.chat.append(h('div.bubble-row', {}, h('div', {},
      h('div.bubble-msg', '…'),
      h('div.bubble-meta', {}, h('span', {}, '在想')))));
  }
  el.chat.scrollTop = el.chat.scrollHeight;
}

async function sendChat() {
  const ctx = ctxRef;
  if (!ctx || thinking) return;
  const text = (el.chatInput.value || '').trim();
  if (!text) { el.chatInput.focus(); return; }
  el.chatInput.value = '';
  pushMsg('me', text);
  thinking = true;
  paint(ctx);
  const before = Date.now();
  try {
    const res = await ctx.run('ai.op', { op: 'chat', text }, { timeout: 90000 });
    if (res && res.ok === false) {
      pushMsg('ai', res.error || '没答上来', { bad: true });
    } else if (res?.speech && replyMark < before) {
      // 事件没到（例如 WS 刚好重连），用返回值兜一次
      pushMsg('ai', res.speech, { source: res.source, skill: res.skill });
    }
  } catch (err) {
    pushMsg('ai', err.message || '出错了', { bad: true });
  } finally {
    thinking = false;
    streamingNode = null;
    renderChat();
    if (ctxRef) paint(ctxRef);
  }
}

function say(text) {
  if (!ctxRef || !text) return;
  ctxRef.run('ai.op', { op: 'say', text }).catch(() => {});
}

/* ---------------------------------------------------------------- 技能 */
async function loadSkills() {
  const ctx = ctxRef;
  if (!ctx || !ctx.link.online) return;
  try {
    const res = await ctx.cmd('ai.op', { op: 'skills' });
    skills = res?.items || [];
    renderSkills(res?.errors || {});
  } catch (err) {
    el.skillNote.textContent = `技能列表读不到：${err.message || err}`;
  }
}

function renderSkills(errors = {}) {
  if (!el.skillGrid) return;
  el.skillNote.textContent = skills.length
    ? `${skills.length} 个技能已加载；关掉的技能不会被匹配到。`
    : '还没装技能。技能就是一个小目录（skill.json + handler.py）。';
  if (!skills.length) {
    el.skillGrid.replaceChildren(h('div.empty', { style: { gridColumn: '1 / -1' } },
      h('strong', {}, '技能库是空的'),
      h('p', {}, '点右上角「安装技能」，给一个 zip 路径或下载地址。')));
    return;
  }
  el.skillGrid.replaceChildren(...skills.map((s) => {
    const err = s.last_error || s.error || errors[s.id];
    return h('div.skill-card', { dataset: { off: s.enabled ? '0' : '1' } },
      h('div.top', {},
        h('span.ic', {}, icon('ai', 15)),
        h('span.nm.grow', { title: s.id }, s.name || s.id),
        switchEl(Boolean(s.enabled), (on) => toggleSkill(s.id, on), { label: `${s.name} 开关` })),
      h('div.desc', s.description || '没有描述'),
      err ? h('div.hint-line', { style: { color: 'var(--danger-ink)' } }, `错误：${err}`) : null,
      h('div.foot', {},
        h('span.skill-id', {}, `${s.id}${s.version ? ` v${s.version}` : ''}`),
        btn('卸载', {
          size: 'sm', kind: 'ghost', icon: 'trash',
          onClick: () => uninstallSkill(s.id, s.name || s.id),
        })));
  }));
}

async function toggleSkill(id, on) {
  const ctx = ctxRef;
  if (!ctx) return;
  try {
    await ctx.run('ai.op', { op: 'skill_toggle', id, on });
    const s = skills.find((x) => x.id === id);
    if (s) s.enabled = on;
    renderSkills();
    toast(`${id} ${on ? '已启用' : '已停用'}`, 'ok', 1800);
  } catch { loadSkills(); }
}

async function uninstallSkill(id, name) {
  const ctx = ctxRef;
  if (!ctx) return;
  const ok = await ctx.confirm({
    title: `卸载 ${name}`,
    message: '目录会被移到 state_dir/skills_removed，不是彻底删除，还能手工找回来。',
    okText: '卸载',
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.run('ai.op', { op: 'skill_uninstall', id });
    toast(`已卸载 ${id}`, 'ok');
    loadSkills();
  } catch { /* 已提示 */ }
}

async function installSkill() {
  const ctx = ctxRef;
  if (!ctx) return;
  const input = await ctx.ask({
    title: '安装技能',
    label: 'zip 路径或下载地址',
    placeholder: 'D:/skills/weather.zip 或 https://…/weather.zip',
    hint: 'zip 里要有 skill.json（id / name / entry）。装了会立刻热加载。',
    mono: true,
    okText: '安装',
  });
  if (!input) return;
  const isUrl = /^https?:\/\//i.test(input);
  try {
    const res = await ctx.run('ai.op', isUrl ? { op: 'skill_install', url: input } : { op: 'skill_install', zip_path: input },
      { timeout: 90000 });
    toast(`已安装 ${res?.id || res?.name || '技能'}`, 'ok', 4200);
    loadSkills();
  } catch { /* 已提示 */ }
}

/* ---------------------------------------------------------------- 模型配置 */
async function loadConfig() {
  const ctx = ctxRef;
  if (!ctx || !ctx.link.online || cfgLoaded) return;
  try {
    const res = await ctx.cmd('ai.op', { op: 'config' });
    applyCfg(res || {});
    cfgLoaded = true;
  } catch { /* 配置项读不到不算错，页面照样能用 */ }
}

function applyCfg(cfg) {
  if (!el.baseUrl) return;
  el.baseUrl.value = cfg.base_url || '';
  el.modelName.value = cfg.model || '';
  el.provider.value = cfg.provider || '';
  el.apiKey.value = '';
  el.apiKey.placeholder = cfg.api_key || (cfg.has_key ? 'sk-***' : 'sk-…');
  el.keyChip.replaceChildren(
    cfg.has_key ? chip(`已配置 ${cfg.api_key || 'sk-***'}`, 'ok') : chip('没有 key', 'danger'));
}

async function saveCfg() {
  const ctx = ctxRef;
  if (!ctx) return;
  const args = {
    op: 'config',
    base_url: el.baseUrl.value.trim(),
    model: el.modelName.value.trim(),
    provider: el.provider.value.trim() || 'openai_compatible',
  };
  const key = el.apiKey.value.trim();
  if (key) args.api_key = key;
  try {
    const res = await ctx.run('ai.op', args);
    applyCfg(res || {});
    el.cfgResult.textContent = '已保存。';
    cfgLoaded = true;
    toast('模型配置已保存', 'ok');
  } catch { /* 已提示 */ }
}

async function testCfg() {
  const ctx = ctxRef;
  if (!ctx) return;
  el.cfgResult.textContent = '正在测…';
  try {
    const res = await ctx.run('ai.op', { op: 'test' }, { timeout: 30000 });
    el.cfgResult.textContent = `${fmt.int(res?.ms)} ms · ${res?.reply || ''}`;
    toast(`模型通了：${fmt.int(res?.ms)} ms`, 'ok');
  } catch (err) {
    el.cfgResult.textContent = `没通：${err.message || err}`;
  }
}
