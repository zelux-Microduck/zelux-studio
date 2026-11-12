/* 与 zeluxd 的唯一通道：一条 WebSocket，既收状态也发命令。
   - 心跳 1 Hz，带 seq / 可见性 / 路由 / 当前页面关注的模块（后端据此降频）
   - 命令 Promise 化，服务端 ok:false → reject（error 原文照抄）
   - 断线 2 s 起指数退避，最长 8 s；close code 4401 → 交给上层跳登录 */

const HB_MS = 1000;
const CMD_TIMEOUT = 20000;
const BACKOFF_MIN = 2000;
const BACKOFF_MAX = 8000;
const PROTOCOL_SUPPORTED = '>=1.0.0 <2.0.0';

/* 协议把命令写成两段式 `模块.op` + `{op:"scan"}`（docs/10 §3.3）。
   imu / tof / fan / vision 两种写法都收；pad / ai / train / sys 只注册了
   扁平名（`pad.scan`），所以在这里把 `.op` 展开成真实命令名——页面代码
   仍然按文档写，不各自记一套例外。 */
const FLAT_MODULES = new Set(['pad', 'ai', 'train', 'sys']);

function wire(name, args) {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || name.slice(dot + 1) !== 'op') return [name, args];
  const mod = name.slice(0, dot);
  if (!FLAT_MODULES.has(mod)) return [name, args];
  const op = String((args && args.op) || '').trim();
  if (!op) return [name, args];
  const rest = { ...args };
  delete rest.op;
  return [`${mod}.${op}`, rest];
}

export class Link {
  constructor() {
    this.ws = null;
    this.status = 'idle';
    this.csrf = null;
    this.route = '/';
    this.focus = null;
    this.seq = 0;
    this.pending = new Map();
    this.latency = null;
    this.lastMsgAt = 0;
    this.lastHbSentAt = 0;
    this.hello = null;
    this._hbTimer = null;
    this._retryTimer = null;
    this._backoff = BACKOFF_MIN;
    this._stop = false;
    this._msgSubs = new Set();
    this._statusSubs = new Set();
    this._latSubs = new Set();
    this._eventSubs = new Set();
    this._unauthSubs = new Set();
    this._wasOpen = false;
  }

  /* -------------------------------------------------- 订阅 */
  on(fn) { this._msgSubs.add(fn); return () => this._msgSubs.delete(fn); }
  onStatus(fn) { this._statusSubs.add(fn); fn(this.status, this); return () => this._statusSubs.delete(fn); }
  onLatency(fn) { this._latSubs.add(fn); return () => this._latSubs.delete(fn); }
  onEvent(fn) { this._eventSubs.add(fn); return () => this._eventSubs.delete(fn); }
  onUnauth(fn) { this._unauthSubs.add(fn); return () => this._unauthSubs.delete(fn); }

  setStatus(status, detail) {
    if (this.status === status && !detail) return;
    this.status = status;
    for (const fn of [...this._statusSubs]) {
      try { fn(status, this, detail); } catch (err) { console.error('[link] status 订阅者出错', err); }
    }
  }

  setCsrf(token) { this.csrf = token || null; }

  /* -------------------------------------------------- 连接 */
  connect() {
    this._stop = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this._retryTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this.setStatus(this._wasOpen ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.setStatus('error', String(err));
      this._scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this._backoff = BACKOFF_MIN;
      this._wasOpen = true;
      this.setStatus('open');
      this._send({
        t: 'client_hello',
        client: 'zelux-studio',
        version: '1.1.0',
        protocol: { supported: PROTOCOL_SUPPORTED },
      });
      this._startHeartbeat();
      this.ping();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.lastMsgAt = Date.now();
      this._handle(msg);
    };

    ws.onerror = () => {
      /* close 事件会紧跟着来，这里只记状态 */
      if (this.status === 'open') this.setStatus('error');
    };

    ws.onclose = (ev) => {
      const wasOpen = this.ws === ws;
      if (wasOpen) this.ws = null;
      this._stopHeartbeat();
      this._failPending(ev.code === 4401 ? '登录过期了：重新登录一下' : '连接断了，命令没发出去');
      if (ev.code === 4401) {
        this.setStatus('unauth');
        for (const fn of [...this._unauthSubs]) {
          try { fn(); } catch (err) { console.error('[link] unauth 订阅者出错', err); }
        }
        return;
      }
      if (ev.code === 4403) {
        this.setStatus('denied', '来源校验没过：请用设备自己的地址打开页面');
        return;
      }
      if (ev.code === 4406) {
        this.setStatus('incompatible', 'Studio 与设备协议不兼容，请升级 Studio 或设备端');
        return;
      }
      if (this._stop) { this.setStatus('closed'); return; }
      this.setStatus('reconnecting');
      this._scheduleRetry();
    };
  }

  disconnect() {
    this._stop = true;
    clearTimeout(this._retryTimer);
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this._failPending('已经断开连接');
    this.setStatus('closed');
  }

  _scheduleRetry() {
    clearTimeout(this._retryTimer);
    if (this._stop) return;
    const wait = this._backoff;
    this._backoff = Math.min(BACKOFF_MAX, Math.round(this._backoff * 2));
    this._retryTimer = setTimeout(() => {
      if (navigator.onLine === false) { this._scheduleRetry(); return; }
      this.connect();
    }, wait);
  }

  /* -------------------------------------------------- 心跳 */
  _startHeartbeat() {
    this._stopHeartbeat();
    const beat = () => {
      this.ping();
      this._hbTimer = setTimeout(beat, HB_MS);
    };
    beat();
  }

  _stopHeartbeat() {
    clearTimeout(this._hbTimer);
    this._hbTimer = null;
  }

  ping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.seq += 1;
    this.lastHbSentAt = Date.now();
    this._send({
      t: 'hb',
      seq: this.seq,
      visible: document.visibilityState === 'visible',
      route: this.route,
      focus: this.focus,
    });
  }

  /** 立刻重发一次心跳（切页时用，后端据此立刻切全量/降频） */
  refocus() { this.ping(); }

  /* -------------------------------------------------- 收消息 */
  _handle(msg) {
    const t = msg.t;
    if (t === 'state') {
      for (const fn of [...this._msgSubs]) {
        try { fn(msg.data || {}); } catch (err) { console.error('[link] state 订阅者出错', err); }
      }
      return;
    }
    if (t === 'result') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        entry.resolve(msg.data === undefined ? {} : msg.data);
      } else {
        const err = new Error(msg.error || '服务端没给原因');
        err.code = msg.code || 'failed';
        entry.reject(err);
      }
      return;
    }
    if (t === 'hello') {
      this.hello = msg;
      return;
    }
    if (t === 'hb') {
      if (this.lastHbSentAt) {
        this.latency = Math.max(0, Date.now() - this.lastHbSentAt);
        for (const fn of [...this._latSubs]) {
          try { fn(this.latency, this); } catch { /* ignore */ }
        }
      }
      return;
    }
    if (t === 'event') {
      for (const fn of [...this._eventSubs]) {
        try { fn(msg.name, msg.data || {}); } catch (err) { console.error('[link] event 订阅者出错', err); }
      }
      return;
    }
    if (t === 'error' && msg.error?.code === 'protocol.incompatible') {
      this.setStatus('incompatible', msg.error.message || 'Studio 与设备协议不兼容');
    }
  }

  /* -------------------------------------------------- 命令 */
  cmd(name, args = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        const err = new Error('没连上设备：命令没发出去');
        err.code = 'offline';
        reject(err);
        return;
      }
      const id = `c${++this.seq}-${Math.random().toString(36).slice(2, 7)}`;
      const timeout = opts.timeout || CMD_TIMEOUT;
      const [name2, args2] = wire(name, args);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const err = new Error('等太久了，操作可能还在跑');
        err.code = 'timeout';
        reject(err);
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, name: name2 });
      const ok = this._send({
        t: 'cmd',
        id,
        name: name2,
        args: args2,
        timeout: Math.round(timeout / 1000),
      });
      if (!ok) {
        clearTimeout(timer);
        this.pending.delete(id);
        const err = new Error('连接断了：命令没发出去');
        err.code = 'offline';
        reject(err);
      }
    });
  }

  _send(obj) {
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  _failPending(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      const err = new Error(reason);
      err.code = 'offline';
      entry.reject(err);
    }
    this.pending.clear();
  }

  get online() { return this.status === 'open'; }
}

export const link = new Link();
export default link;
