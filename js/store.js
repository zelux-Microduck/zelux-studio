/* 极简状态容器：只存 state 与本地 UI 状态。
   订阅是同步的；页面自己在 mount 里订阅、unmount 里退订。 */

const data = new Map();
const subs = new Set();

export function get(key, fallback = undefined) {
  return data.has(key) ? data.get(key) : fallback;
}

/** set('st', obj) 或 set({a:1,b:2})；值相同则不通知 */
export function set(key, value) {
  if (typeof key === 'object' && key !== null) {
    let changed = false;
    for (const [k, v] of Object.entries(key)) {
      if (data.get(k) !== v) { data.set(k, v); changed = true; }
    }
    if (changed) notify(key);
    return;
  }
  if (data.get(key) === value) return;
  data.set(key, value);
  notify(key);
}

export function patch(key, partial) {
  const cur = data.get(key);
  if (!cur || typeof cur !== 'object') { set(key, partial); return; }
  set(key, { ...cur, ...partial });
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function notify() {
  for (const fn of [...subs]) {
    try { fn(get('st'), get('ui')); } catch (err) { console.error('[store] 订阅者出错', err); }
  }
}

/** 当前后端快照（可能是 null：还没连上） */
export function state() {
  return get('st') || null;
}

export function ui() {
  return get('ui') || {};
}

export function setUi(partial) {
  set('ui', { ...(get('ui') || {}), ...partial });
}
