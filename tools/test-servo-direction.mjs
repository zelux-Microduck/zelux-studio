import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/pages/servos.js', import.meta.url), 'utf8');
const workflow = source.slice(source.indexOf('const directionJobs'), source.indexOf('function sendSliderGoal'));
assert.ok(workflow.includes('async function configureDirection'));
assert.ok(source.includes("h('span.direction-cell'"), 'every servo card offers a direction action');
const all = node => [node, ...(node.children || []).flatMap(all)];
const h = (tag, attrs, ...children) => ({ tag, attrs, children, value: '' });
const messages = [], errors = [], calls = [];
const ctx = vm.createContext({ h, btn: (text, opts) => ({ text, opts }), NAME_CN: {},
  toast: (...args) => messages.push(args), toastError: err => errors.push(err), session: ctx => ctx.inSession });
vm.runInContext(workflow, ctx);
const ids = [20, 21, 22, 23, 24, 30, 31, 32, 33, 34, 10, 11, 12, 13, 14];
let status = { schema: 'zelux.servo-directions/v1', ids, saved: ids.map(() => 1), runtime: ids.map(() => 1), pending_restart: false };
let confirm = true;
const page = {
  cmd: async (...args) => { calls.push(args); return status; },
  run: async (...args) => { calls.push(args); return { pending_restart: true }; },
  confirm: async opts => {
    const select = all(opts.body).find(node => node.tag === 'select');
    if (select) select.value = '-1';
    return confirm;
  },
};
for (const id of ids) {
  await ctx.configureDirection(page, id);
  const [name, args] = calls.at(-1);
  assert.equal(name, 'servo.direction');
  assert.equal(args.action, 'save');
  assert.equal(args.id, id);
  assert.equal(args.direction, -1);
  assert.deepEqual(Array.from(args.expected), status.saved);
  assert.equal(args.confirmed, true);
}
assert.ok(messages.at(-1)[0].includes('待安全重启'), 'saving is not presented as live application');
confirm = false;
await ctx.configureDirection(page, 30);
assert.equal(calls.at(-1)[1].action, 'status', 'cancel must not save');
confirm = true;
status = {};
await ctx.configureDirection(page, 30);
assert.equal(calls.at(-1)[1].action, 'status', 'missing support must not guess directions');
status = { schema: 'zelux.servo-directions/v1', saved: ids.map(() => -1), pending_restart: false };
await ctx.applySavedDirections(page);
assert.equal(calls.at(-1)[1].action, 'status', 'no pending settings must not restart');
status.pending_restart = true;
page.inSession = true;
await ctx.applySavedDirections(page);
assert.equal(calls.at(-2)[0], 'servo.bus');
assert.equal(calls.at(-2)[1].op, 'release');
assert.equal(calls.at(-1)[1].action, 'restart');
assert.equal(calls.at(-1)[1].confirmed, true);
confirm = false;
const count = calls.length;
await ctx.restartDirections(page, ids.map(() => -1));
assert.equal(calls.length, count, 'cancel must not release or restart');
assert.equal(errors.length, 0);
console.log('PASS: all 15 direction buttons, explicit save, pending application, cancellation and safe restart workflow');
