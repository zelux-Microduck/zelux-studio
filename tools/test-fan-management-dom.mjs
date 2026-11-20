import assert from 'node:assert/strict';

class Element {
  constructor(tag = '') {
    this.tagName = tag; this.children = []; this.events = {}; this.style = {};
    this.dataset = {}; this.attributes = {}; this.value = ''; this.className = '';
    this.parentNode = null; this.disabled = false;
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  set value(val) { this._value = String(val); }
  get value() { return this._value; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
  addEventListener(name, fn) { this.events[name] = fn; }
  setAttribute(key, val) { this.attributes[key] = val; if (key === 'id') this.id = val; }
  set textContent(val) { this.text = String(val); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(x => x.textContent).join(''); }
  querySelectorAll(selector) {
    return all(this).slice(1).filter(node => selector.startsWith('#') ? node.id === selector.slice(1)
      : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const all = node => [node, ...node.children.flatMap(all)];
globalThis.Node = Element;
globalThis.document = {
  createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
  createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; },
  getElementById: () => null,
};
globalThis.window = { confirm: () => true };
const fanPage = await import('../js/pages/fan.js');
const calls = [];
let notify;
const instance = { id: 'main', name: 'Main', driver_id: 'zelux.fan.radxa-pwm', enabled: true,
  pwm: { chip: 0, channel: 0 }, period_ns: 40000 };
let state = { fan: { available: true, mode: 'auto', inventory: { instances: [instance] },
  items: [{ id: 'main', pct: 60, control_mode: 'auto' }] } };
const ctx = { link: { online: true }, state: () => state,
  store: { subscribe(fn) { notify = fn; return () => {}; } },
  run: async (name, args) => { calls.push([name, args]); return { result: { released: [] } }; },
  cmd: async (name, args) => { calls.push([name, args]); return {}; } };
const root = fanPage.page(ctx);
fanPage.mount(ctx);
const firstRange = root.querySelectorAll('input').find(n => n.attributes.type === 'range');
const nameInput = root.querySelectorAll('input').find(n => n.attributes.type === 'text');
const editorSave = all(root).find(n => n.tagName === 'button' && n.textContent === '保存实例');
const editorSaveParent = editorSave.parentNode;
nameInput.value = 'unsaved local edit';
const button = text => all(root).find(n => n.tagName === 'button' && n.textContent === text);
await button('禁用实例').events.click();
assert.equal(calls.at(-1)[1].op, 'instance_disable');
assert.equal(calls.at(-1)[1].instance_id, 'main');
state = { fan: { ...state.fan, inventory: { instances: [{ ...instance, enabled: false }] }, items: [] } };
notify();
assert.equal(root.querySelectorAll('input').find(n => n.attributes.type === 'range').disabled, true);
assert.equal(root.querySelectorAll('input').find(n => n.attributes.type === 'range'), firstRange,
  'polling must preserve live fan-card node identity');
assert.equal(root.querySelectorAll('input').find(n => n.attributes.type === 'text'), nameInput,
  'polling must preserve editor input node identity');
assert.equal(nameInput.value, 'unsaved local edit', 'polling must not overwrite an in-progress edit');
assert.equal(editorSave.parentNode, editorSaveParent,
  'polling must keep the existing editor row in place');
await button('启用实例').events.click();
assert.equal(calls.at(-1)[1].op, 'instance_enable');
await button('保存实例').events.click();
assert.equal(calls.at(-1)[1].instance.enabled, false, 'save must not re-enable stale editor state');
const count = calls.length;
button('添加风扇实例').events.click();
const drafts = all(root).filter(n => n.tagName === 'button' && n.textContent === '删除实例');
await drafts[0].events.click();
assert.equal(calls.length, count, 'discarding draft must not call service');
ctx.link.online = false;
notify();
assert.equal(button('启用实例').disabled, true);
fanPage.unmount();
console.log('PASS: fan DOM enable/disable, immutable identity, stale editor state, draft deletion and offline gating');

// Creation must replace the draft immediately, without waiting for polling.
ctx.link.online = true;
ctx.store.set = (key, value) => { assert.equal(key, 'st'); state = value; notify?.(); };
state = { otherModule: { keep: true }, fan: { available: true, inventory: { instances: [] }, items: [] } };
let view = fanPage.page(ctx);
fanPage.mount(ctx);
const findButton = (view, text) => all(view).find(n => n.tagName === 'button' && n.textContent === text);
function newDraft(view) {
  findButton(view, '添加风扇实例').events.click();
  const save = findButton(view, '保存实例');
  const inputs = save.parentNode.parentNode.querySelectorAll('input');
  inputs[2].value = '0'; inputs[3].value = '0';
  return { save, id: inputs[0].value };
}
let draft = newDraft(view);
let release;
ctx.run = (name, args) => { calls.push([name, args]); return new Promise(resolve => { release = resolve; }); };
let pending = draft.save.events.click();
const beforeDuplicate = calls.length;
await draft.save.events.click();
assert.equal(calls.length, beforeDuplicate, 'pending create must not be replayed');
assert.equal(draft.save.disabled, true);
const persisted = { ...instance, id: draft.id };
release({ result: { ok: true }, fan: { available: true, inventory: { instances: [persisted] },
  items: [{ id: draft.id, pct: 60 }] } });
await pending;
assert.equal(findButton(view, '保存实例').parentNode.parentNode.querySelectorAll('input')[0].disabled, true,
  'saved draft becomes a persisted editor immediately');
assert.equal(state.otherModule.keep, true, 'merging command result preserves other modules');
fanPage.unmount();

// A sent write with no confirmation only triggers a read, not another create.
state = { fan: { available: true, inventory: { instances: [] }, items: [] } };
view = fanPage.page(ctx); fanPage.mount(ctx); draft = newDraft(view);
ctx.run = async (name, args) => { calls.push([name, args]); throw Object.assign(new Error('unknown'), { code: 'outcome_unknown' }); };
ctx.cmd = async (name, args) => { calls.push([name, args]); return { fan: state.fan }; };
await draft.save.events.click();
assert.equal(calls.at(-1)[1].op, 'status');
const afterUnknown = calls.length;
await draft.save.events.click();
assert.equal(calls.length, afterUnknown, 'unknown write must not invite a duplicate create');
state = { fan: { available: true, inventory: { instances: [{ ...instance, id: draft.id }] }, items: [] } };
notify();
assert.equal(findButton(view, '保存实例').parentNode.parentNode.querySelectorAll('input')[0].disabled, true,
  'late authoritative state confirms and removes the unknown draft');
fanPage.unmount();

// A delayed reply must not write to a newly mounted page, even with the same ctx.
state = { fan: { available: true, inventory: { instances: [] }, items: [] } };
view = fanPage.page(ctx); fanPage.mount(ctx); draft = newDraft(view);
ctx.run = () => new Promise(resolve => { release = resolve; });
pending = draft.save.events.click();
fanPage.unmount();
state = { marker: 'new-page', fan: { available: true, inventory: { instances: [] }, items: [] } };
view = fanPage.page(ctx); fanPage.mount(ctx);
release({ fan: { inventory: { instances: [persisted] } } });
await pending;
assert.equal(state.marker, 'new-page');
assert.equal(state.fan.inventory.instances.length, 0);
fanPage.unmount();
console.log('PASS: immediate create display, duplicate guard, unknown-outcome reconciliation, late response isolation');
