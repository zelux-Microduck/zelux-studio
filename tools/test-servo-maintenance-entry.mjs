import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the production entry point with mocked browser confirmation and transport.
// This is not a full DOM or physical-device acceptance test.
const source = readFileSync(new URL('../js/pages/servos.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const entry = source.match(/async function take\(ctx\) \{[\s\S]*?\n\}(?=\n\nasync function release)/)?.[0];
assert.ok(entry, 'production take entry point must exist');
let confirmed = false;
const calls = [];
const context = vm.createContext({ window: { confirm: message => {
  assert.match(message, /固定支撑/);
  return confirmed;
} }, toast() {} });
vm.runInContext(entry, context);
const ctx = { run: async (...args) => { calls.push(args); return { online: 15 }; } };
await context.take(ctx);
assert.equal(calls.length, 0, 'cancel must not acquire a session');
confirmed = true;
await context.take(ctx);
assert.equal(calls.length, 1);
assert.equal(calls[0][0], 'servo.bus');
assert.equal(calls[0][1].op, 'take');
assert.equal(calls[0][1].supported, true, 'explicit support confirmation reaches transport');
console.log('PASS: servo maintenance entry confirmation and cancellation');

// Repeated telemetry must keep the focused takeover action, not recreate it.
const paint = source.slice(source.indexOf('function paintTakeover'), source.indexOf('async function take'));
assert.ok(paint);
const makeNode = () => ({ textContent: '', disabled: false });
let replacements = 0;
const el = { takeover: { replaceChildren() { replacements += 1; } } };
const dom = vm.createContext({ el, h: makeNode, btn: makeNode, icon: makeNode, release() {}, take() {} });
vm.runInContext(paint, dom);
for (let i = 0; i < 100; i += 1) dom.paintTakeover({}, null, true, {dirty: i});
assert.equal(replacements, 1);
const original = el.takeoverAction;
dom.paintTakeover({}, null, false, {});
assert.equal(el.takeoverAction, original);
assert.equal(original.disabled, true);
dom.paintTakeover({}, {online: 15, holding: 3}, true, {});
assert.equal(replacements, 2);
console.log('PASS: stable takeover DOM across 100 telemetry updates');

const sliderCode = source.slice(source.indexOf('function sendSliderGoal'), source.indexOf('function servoSlider'));
const sliderCalls = [];
let finishFirst;
const sliderContext = vm.createContext({
  sliderQueue: new Map(), sliderLastSent: new Map(), sliderGeneration: 0,
  performance: { now: () => 100000 }, window: { setTimeout: (fn) => { queueMicrotask(fn); } },
  pageCtx: { run: async (_name, args) => {
    sliderCalls.push(args);
    if (sliderCalls.length === 1) await new Promise((resolve) => { finishFirst = resolve; });
  } },
});
vm.runInContext(sliderCode, sliderContext);
sliderContext.sendSliderGoal(20, 2100);
sliderContext.sendSliderGoal(20, 2200);
sliderContext.sendSliderGoal(20, 2300, true);
assert.equal(sliderCalls.length, 1, 'at most one request may be in flight per joint');
finishFirst();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sliderCalls.length, 2);
assert.equal(sliderCalls[1].pos, 2300, 'intermediate values coalesce but the final target is delivered');
console.log('PASS: slider backpressure and final-target delivery');
