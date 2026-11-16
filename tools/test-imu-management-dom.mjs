import assert from 'node:assert/strict';
class Element {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.events = {}; this.style = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.className = ''; }
  append(...children) { this.children.push(...children); if (this.tagName === 'select' && !this.value) this.value = this.children.find(x => !x.disabled)?.value || ''; }
  replaceChildren(...children) { this.children = []; this.value = this.tagName === 'select' ? '' : this.value; this.append(...children); }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(key, value) { this.attributes[key] = value; }
  set textContent(text) { this.text = String(text); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(x => x.textContent).join(''); }
}
globalThis.Node = Element;
globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; } };
const { createImuManagement } = await import('../js/pages/imu-management.js');
let confirmed = true;
const calls = [];
let state = { available: true, catalog: { revision: 'r1', config: { imu: { model: null, source: 'ipc' } },
  models: [{ id: 'qingmu-a1', supported: true, compatible: true, sensor_axes: ['down', 'right', 'back'] },
           { id: 'qingmu-b1', supported: false, compatible: false, reason: 'unverified' }] },
  runtime: { source: 'ipc' }, pending_restart: false, restart_safe: true, ready: false };
const component = createImuManagement({ confirm: async () => confirmed, toast() {},
  run: async (command, args) => { calls.push([command, args]);
    if (command === 'imu.model_select') state = { ...state, pending_restart: true };
    return { saved: true, management: state }; } });
const all = node => [node, ...node.children.flatMap(all)];
const buttons = all(component.element).filter(node => node.tagName === 'button');
const [save, restart] = buttons;
assert.equal(save.disabled, true);
component.paint(state);
assert.equal(save.disabled, false);
assert.equal(restart.disabled, true);
const select = all(component.element).find(node => node.tagName === 'select');
assert.equal(select.children[1].disabled, true);
confirmed = false;
await save.events.click();
assert.equal(calls.length, 0);
confirmed = true;
await save.events.click();
assert.equal(calls[0][0], 'imu.model_select');
assert.equal(calls[0][1].expected, 'r1');
assert.equal(restart.disabled, false);
await restart.events.click();
assert.equal(calls[1][0], 'imu.model_restart');
assert.equal(calls[1][1].mechanically_supported, true);
component.paint({ ...state, available: false });
assert.equal(save.disabled, true);
assert.equal(restart.disabled, true);
component.dispose();
console.log('PASS: IMU DOM controls, confirmation, B1 block and command payloads');

