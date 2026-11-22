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
