/* 极小的 DOM / 格式化 / 反馈工具。
   只有这一层碰 document，页面里不出现字符串拼 HTML —— 所有文本都走 textContent。 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 创建元素：h('div.card#x', {onclick, dataset, style, attrs}, ...children) */
export function h(spec, props, ...children) {
  if (props && (props instanceof Node || Array.isArray(props) || typeof props !== 'object')) {
    children.unshift(props);
    props = null;
  }
  let tag = 'div';
  let cls = '';
  let id = '';
  if (typeof spec === 'string') {
    const m = spec.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
    if (m) {
      tag = m[1] || 'div';
      for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
        if (part[0] === '.') cls += (cls ? ' ' : '') + part.slice(1);
        else id = part.slice(1);
      }
    } else {
      tag = spec;
    }
  }
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (id) el.id = id;
  applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  if (!props || typeof props !== 'object') return;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') { el.className += (el.className ? ' ' : '') + v; continue; }
    if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); continue; }
    if (k === 'dataset' && typeof v === 'object') { Object.assign(el.dataset, v); continue; }
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
      continue;
    }
    if (k === 'text') { el.textContent = String(v); continue; }
    if (k === 'html') { el.innerHTML = v; continue; }
    if (k === 'value') { el.value = v; continue; }
    if (k === 'checked' || k === 'disabled' || k === 'selected') { el[k] = Boolean(v); continue; }
    if (v === true) { el.setAttribute(k, ''); continue; }
    el.setAttribute(k, String(v));
  }
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** 文本节点（便于后续只改文字） */
export function text(v) {
  return document.createTextNode(v === null || v === undefined ? '—' : String(v));
}

export function svg(spec, props, ...children) {
  const el = document.createElementNS(SVG_NS, spec);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) { c.forEach((x) => x && el.append(x)); continue; }
    if (c instanceof Node) el.append(c);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 安全改文字 */
export function paint(node, v) {
  if (!node) return;
  const s = v === null || v === undefined || v === '' ? '—' : String(v);
  if (node.textContent !== s) node.textContent = s;
}

export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/* ---------------------------------------------------------------- 图标 */
const ICONS = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z',
  servo: 'M12 3v3m0 12v3M3 12h3m12 0h3M7.8 7.8 5.6 5.6m12.8 12.8-2.2-2.2M16.2 7.8l2.2-2.2M7.8 16.2l-2.2 2.2M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z',
  imu: 'M12 3.5 20 8v8l-8 4.5L4 16V8zM12 8.2 16.4 11v4L12 17.6 7.6 15v-4z',
  pad: 'M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.6a2.6 2.6 0 0 1-4.5 1.2L14 16H10l-1.7 1.7a2.6 2.6 0 0 1-4.5-1.2l-.7-3.6a4.5 4.5 0 0 1 4.4-5.4ZM8 11v3m-1.5-1.5h3M15.6 11.4h.01M17.8 13.2h.01',
  camera: 'M4 8.5h2.6L8 6.5h8l1.4 2H20v10H4zM12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  tof: 'M12 3v3M4.8 7.2 7 9.4M3 15h3M19.2 7.2 17 9.4M21 15h-3M8.2 20.4A7 7 0 0 1 12 9a7 7 0 0 1 3.8 11.4M12 12.5v3',
  fan: 'M12 12c0-3 .6-6-1.4-7.2C8.4 3.4 6 5.4 6.6 8c.4 1.6 2 2.6 3.4 3M12 12c2.6-1.5 5.6-2.4 6-4.6.5-2.4-2.2-4-4.2-2.6C12.4 5.8 12 8.4 12 10m0 2c3 0 6 .6 7.2-1.4 1.4-2.2-.6-4.6-3.2-4M12 12c-1.5 2.6-2.4 5.6-4.6 6-2.4.5-4-2.2-2.6-4.2M12 12c-.2 1.9 1 5.6 3 6.6 2.2 1.1 4.4-1 3.4-3.2-.7-1.5-2.5-2.4-4.4-3.4M12 12a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z',
  ai: 'M12 3.2 13.9 9l5.9 1.9-5.9 1.9L12 18.7l-1.9-5.9L4.2 10.9 10.1 9ZM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z',
  train: 'M4 18V9m4 9V5m4 13v-7m4 7V7m4 11v-4',
  logs: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z',
  duck: 'M4 14c2-4 5-6 9-6 1.2-2.3 3.4-4 6.2-4.2-.7 1.5-.7 2.8-.1 4 1 .3 1.9.8 2.7 1.6l-2.4 1.5c.7 1.1 1 2.5.8 4.1-.3 2.7-2.7 4.7-5.5 4.7H9c-2.8 0-4.8-1.8-5-4.5Zm13-5.4 3.6-1.2-2.9 2.1M9 19v2m6-2v2',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  bolt: 'M13 3 5 13h5l-1 8 8-10h-5z',
  check: 'M4.5 12.5 9 17 19.5 6.5',
  alert: 'M12 4 21 19H3zM12 9.5v4M12 16.5h.01',
  x: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5.5v13l11-6.5z',
  trash: 'M4.5 7h15M9 7V4.8h6V7M6.5 7l.8 12.2h9.4L17.5 7M10 10.5V17M14 10.5V17',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5',
  power: 'M12 4v8M7.5 6.5a7 7 0 1 0 9 0',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M8 8l4-4 4 4M4 16v3.5h16V16',
  download: 'M12 4v12M8 12l4 4 4-4M4 16v3.5h16V16',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4ZM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6',
  battery: 'M3 8h14v8H3zM17.5 10.5h2v3h-2M6 11h7',
  wifi: 'M3.5 9a12 12 0 0 1 17 0M6.5 12.5a8 8 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0M12 19h.01',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 7.5V12l3.2 2',
  cpu: 'M8 8h8v8H8zM6 6h12v12H6zM10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  record: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  lock: 'M6 11h12v9H6zM9 11V7.5a3 3 0 0 1 6 0V11',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 11v5.5M12 7.6h.01',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  wifiOff: 'M3 3l18 18M12 19h.01',
  send: 'M4 12 20 4l-6 16-3.5-6.5z',
  dot: 'M12 12h.01',
};

export function icon(name, size = 16) {
  const d = ICONS[name] || ICONS.dot;
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.7');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  el.append(p);
  return el;
}

/* ---------------------------------------------------------------- 组件 */
export function btn(label, opts = {}) {
  const kind = opts.kind || '';
  const size = opts.size || '';
  const el = h('button', {
    class: ['btn', kind && `btn-${kind}`, size && `btn-${size}`, opts.class || ''].filter(Boolean).join(' '),
    type: opts.type || 'button',
    title: opts.title || null,
    'aria-label': opts.ariaLabel || null,
    disabled: opts.disabled || false,
    onclick: opts.onClick || null,
  });
  if (opts.icon) el.append(icon(opts.icon, opts.iconSize || 15));
  if (label !== null && label !== undefined && label !== '') {
    el.append(h('span', String(label)));
  }
  return el;
}

export function switchEl(checked, onChange, opts = {}) {
  const el = h('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': opts.label || '开关',
    disabled: opts.disabled || false,
  });
  el.addEventListener('click', () => {
    if (el.disabled) return;
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return el;
}

export function selectEl(options, value, onChange, opts = {}) {
  const el = h('select', { class: 'select', 'aria-label': opts.label || '选择' });
  for (const o of options) {
    const option = h('option', { value: o.value }, o.label);
    if (String(o.value) === String(value)) option.selected = true;
    el.append(option);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function chip(label, kind = '') {
  const el = h('span', { class: `chip ${kind ? `chip-${kind}` : ''}` });
  if (kind === 'ok' || kind === 'warn' || kind === 'danger') el.append(h('i.dot'));
  el.append(h('span', label));
  return el;
}

/** 卡片：返回带 .body 的元素 */
export function card(opts = {}, ...children) {
  const head = opts.title
    ? h('div.card-head', {},
        h('div', {},
          h('div.card-title', opts.title),
          opts.sub ? h('div.card-sub', opts.sub) : null),
        opts.actions ? h('div.row', ...(Array.isArray(opts.actions) ? opts.actions : [opts.actions])) : null)
    : null;
  const body = h('div', { class: `card-body${opts.tight ? ' tight' : ''}${opts.flush ? ' flush' : ''}` }, ...children);
  const el = h('section.card', head, body);
  el.body = body;
  return el;
}

export function empty(title, desc) {
  return h('div.empty', {},
    h('strong', title),
    desc ? h('p', desc) : null);
}

export function kvRow(label, value) {
  return h('div.kv', {}, h('span.kv-k', label), h('span.kv-v', value));
}

export function kvRowNode(label, node) {
  return h('div.kv', {}, h('span.kv-k', label), h('span.kv-v', {}, node));
}

export function note(textContent, kind = '', iconName = 'info') {
  return h('div', { class: `note ${kind ? `note-${kind}` : ''}` }, icon(iconName, 15), h('div', {}, textContent));
}

/* ---------------------------------------------------------------- 格式化 */
export const DASH = '—';

export const fmt = {
  n(v, d = 0) {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return DASH;
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  f1(v) { return fmt.n(v, 1); },
  f2(v) { return fmt.n(v, 2); },
  int(v) { return fmt.n(v, 0); },
  pct(v, d = 0) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return DASH;
    return `${fmt.n(v, d)}%`;
  },
  mm(v) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return DASH;
    const n = Number(v);
    return n >= 1000 ? `${fmt.n(n / 1000, 2)} m` : `${fmt.n(n, 0)} mm`;
  },
  deg(v, d = 1) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return DASH;
    return `${fmt.n(v, d)}°`;
  },
  ms(v) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return DASH;
    const n = Number(v);
    return n >= 1000 ? `${fmt.n(n / 1000, 2)} s` : `${fmt.n(n, 0)} ms`;
  },
  sec(v, d = 1) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return DASH;
    return `${fmt.n(v, d)} s`;
  },
  clock(ts) {
    if (!ts) return DASH;
    const d = new Date(ts * 1000);
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  date(ts) {
    if (!ts) return DASH;
    const d = new Date(ts * 1000);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  ago(ts) {
    if (!ts) return DASH;
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return `${Math.round(s)} 秒前`;
    if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
    return `${Math.round(s / 86400)} 天前`;
  },
  dur(sec) {
    if (sec === null || sec === undefined) return DASH;
    const s = Math.max(0, Math.round(Number(sec)));
    const m = Math.floor(s / 60);
    return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  },
};

/** 读嵌套字段，永不抛错 */
export function get(obj, path, fallback = undefined) {
  if (!obj) return fallback;
  let cur = obj;
  for (const key of String(path).split('.')) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[key];
  }
  return cur === null || cur === undefined ? fallback : cur;
}

/* ---------------------------------------------------------------- toast */
let toastBox = null;
function toastsRoot() {
  if (!toastBox) toastBox = document.getElementById('toasts');
  return toastBox;
}

export function toast(message, kind = 'info', ms = 3600) {
  const root = toastsRoot();
  if (!root) return;
  const iconName = kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : kind === 'warn' ? 'alert' : 'info';
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(iconName, 15), h('div.grow', String(message)));
  root.append(el);
  const kill = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 200);
  };
  const timer = setTimeout(kill, Math.max(1200, ms));
  el.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return el;
}

/** 服务端返回的 error 原文照抄，不自己编文案 */
export function toastError(err) {
  const msg = err && err.message ? err.message : String(err || '出错了');
  toast(msg, 'error', 5200);
}

/* ---------------------------------------------------------------- 弹窗 */
let modalStack = 0;

function openModal({ title, sub, body, footer, onClose, wide }) {
  const root = document.getElementById('modal-root');
  const mask = h('div.modal-mask', { role: 'presentation' });
  const closeBtn = h('button', {
    class: 'btn btn-ghost btn-sm modal-x', type: 'button', 'aria-label': '关闭', onclick: () => close(false),
  }, icon('x', 14));
  const titleId = `mt-${++modalStack}`;
  const dlg = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    style: wide ? { width: 'min(720px, 100%)' } : null,
  },
    h('div.modal-head', {},
      h('div.grow', {},
        h('div.modal-title', { id: titleId }, title || ''),
        sub ? h('div.modal-sub', sub) : null),
      closeBtn),
    h('div.modal-body', {}, body || ''),
    footer ? h('div.modal-foot', {}, footer) : null);
  mask.append(dlg);

  let done = false;
  const prevFocus = document.activeElement;
  function close(result) {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    mask.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch { /* ignore */ }
    }
    if (onClose) onClose(result);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
    if (e.key === 'Tab') {
      const items = dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const list = [...items].filter((n) => !n.disabled);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(null); });
  root.append(mask);
  const focusable = dlg.querySelector('input, textarea, select, button.btn-primary, button');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { el: dlg, close };
}

/** 确认框 → Promise<boolean> */
export function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    const okText = opts.okText || '确认';
    const cancelText = opts.cancelText || '取消';
    const okBtn = btn(okText, {
      kind: opts.danger ? 'danger' : 'primary',
      onClick: () => { m.close(true); },
    });
    const cancelBtn = btn(cancelText, { onClick: () => m.close(false) });
    const m = openModal({
      title: opts.title || '确认',
      sub: opts.sub || '',
      body: opts.body || h('div', opts.message || ''),
      footer: [cancelBtn, okBtn],
      wide: opts.wide,
      onClose: (r) => resolve(r === true),
    });
  });
}

/** 输入框 → Promise<string|null> */
export function askDialog(opts = {}) {
  return new Promise((resolve) => {
    const input = h(opts.multiline ? 'textarea.input' : 'input.input', {
      class: 'input input-lg',
      placeholder: opts.placeholder || '',
      value: opts.value || '',
      rows: opts.multiline ? 3 : null,
      spellcheck: 'false',
      'aria-label': opts.label || opts.title || '输入',
    });
    if (opts.mono) input.classList.add('mono');
    const okBtn = btn(opts.okText || '确定', {
      kind: 'primary',
      onClick: () => { const v = input.value; m.close(v); },
    });
    const cancelBtn = btn('取消', { onClick: () => m.close(null) });
    const submit = (e) => {
      e.preventDefault();
      const v = input.value;
      m.close(v);
    };
    const form = h('form.stack-8', { onsubmit: submit },
      opts.label ? h('label.field-label', opts.label) : null,
      input,
      opts.hint ? h('div.field-hint', opts.hint) : null);
    const m = openModal({
      title: opts.title || '输入',
      sub: opts.sub || '',
      body: form,
      footer: [cancelBtn, okBtn],
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); m.close(input.value); }
    });
  });
}

/* ---------------------------------------------------------------- 小工具 */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  const run = () => {
    last = Date.now();
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    if (args) fn(...args);
  };
  return (...args) => {
    const now = Date.now();
    const left = ms - (now - last);
    pendingArgs = args;
    if (left <= 0) { if (timer) clearTimeout(timer); timer = null; run(); }
    else if (!timer) timer = setTimeout(run, left);
  };
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** 设备像素比自适应画布：返回 ctx 与 CSS 尺寸 */
export function fitCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(1, Math.round(cssW));
  const hgt = Math.max(1, Math.round(cssH));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}

export function copyText(str) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(str).then(() => true).catch(() => fallbackCopy(str));
  }
  return Promise.resolve(fallbackCopy(str));
}

function fallbackCopy(str) {
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
