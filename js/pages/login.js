/* 登录页：口令输入。
   口令只在首次开机时设过一次（默认 zelux），之后可以到设置页改。 */

import { h, icon, btn } from '../ui.js';

let root = null;
let input = null;
let errBox = null;
let submitBtn = null;
let busy = false;

export function page(ctx) {
  input = h('input.input.input-lg', {
    type: 'password',
    id: 'pw',
    name: 'password',
    autocomplete: 'current-password',
    placeholder: '口令',
    'aria-label': '设备口令',
    required: true,
  });

  errBox = h('div.login-err', { role: 'alert', 'aria-live': 'assertive' });

  submitBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, '进入控制台');

  const form = h('form.stack', { onsubmit: (e) => { e.preventDefault(); submit(ctx); } },
    h('label.field', {}, h('span.field-label', '设备口令'), input),
    submitBtn,
    errBox);

  root = h('div.login-wrap', {},
    h('div.login-card', {},
      h('div.login-brand', {},
        h('img', { src: './assets/logo.svg', alt: 'ZELUX', width: 44, height: 44 }),
        h('div', {},
          h('div.n', 'ZELUX'),
          h('div.s', 'Duck Studio'))),
      h('h1.login-title', '输入口令'),
      h('p.login-desc', '口令在首次开机时设过，默认是 zelux。登录后这台设备的控制权就归你了。'),
      form,
      h('div.login-foot', {},
        h('span', {}, '忘了口令？在设备上删掉 var/auth.json 再重启，会恢复默认口令。'),
        h('span.mono', {}, 'v1.0.0'))),
    h('div.sr-only', { 'aria-live': 'polite' }, 'ZELUX Duck Studio 登录页'));

  return root;
}

export function mount(ctx) {
  if (!input) return;
  input.value = '';
  setError('');
  input.disabled = false;
  submitBtn.disabled = false;
  setBusy(false);
  // 移动端不主动弹键盘，桌面端直接聚焦
  if (window.matchMedia('(min-width: 700px)').matches) {
    setTimeout(() => input && input.focus(), 60);
  }
}

export function unmount() {
  root = null;
  input = null;
  errBox = null;
  submitBtn = null;
  busy = false;
}

function setError(msg) {
  if (!errBox) return;
  errBox.replaceChildren();
  if (msg) {
    errBox.append(h('div.note.note-danger', {}, icon('alert', 15), h('div', {}, msg)));
  }
}

function setBusy(on) {
  busy = on;
  if (!submitBtn) return;
  submitBtn.disabled = on;
  submitBtn.replaceChildren();
  if (on) submitBtn.append(h('span.spin'), h('span', {}, '正在核对…'));
  else submitBtn.append(h('span', {}, '进入控制台'));
}

async function submit(ctx) {
  if (busy || !input) return;
  const password = input.value;
  if (!password) {
    setError('口令是空的');
    input.focus();
    return;
  }
  setBusy(true);
  setError('');
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      input.value = '';
      ctx.onLogin(data);
      return;
    }
    setError(data.error || `登录没成功（HTTP ${res.status}）`);
    input.select();
  } catch (err) {
    setError(`连不上设备：${err.message || err}`);
  } finally {
    setBusy(false);
  }
}
