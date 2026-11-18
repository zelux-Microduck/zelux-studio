import assert from 'node:assert/strict';

class Element {
  constructor(tag = '') {
    this.tagName = tag; this.children = []; this.events = {}; this.style = {};
    this.dataset = {}; this.attributes = {}; this.value = ''; this.className = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  set value(val) { this._value = String(val); }
  get value() { return this._value; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
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
const button = text => all(root).find(n => n.tagName === 'button' && n.textContent === text);
await button('禁用实例').events.click();
assert.equal(calls.at(-1)[1].op, 'instance_disable');
assert.equal(calls.at(-1)[1].instance_id, 'main');
state = { fan: { ...state.fan, inventory: { instances: [{ ...instance, enabled: false }] }, items: [] } };
notify();
assert.equal(root.querySelectorAll('input').find(n => n.attributes.type === 'range').disabled, true);
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
