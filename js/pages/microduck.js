/* MicroDuck 工作台：外观预览、主题配色、背景图和姿态联动。 */

import { h, btn, card, chip, toast } from '../ui.js';
import { createDuck } from '../duck2d.js';
import {
  EDITIONS, currentEdition, currentShellColor, currentWallpaperOpacity, hasWallpaper,
  setEdition, setCustomShellColor, setWallpaperOpacity, resetCustomShellColor,
  setWallpaperFile, setWallpaperUrl, clearWallpaper,
} from '../theme.js';

let ctxRef = null;
let duck = null;
let unsub = null;
let el = {};

export function page(ctx) {
  ctxRef = ctx;
  const canvas = h('canvas', { 'aria-label': 'MicroDuck 外观预览，姿态同步当前舵机状态' });
  const canvasBox = h('div.microduck-preview', {}, canvas,
    h('div.microduck-badge', {}, chip('姿态同步', 'ok'), chip('MicroDuck', 'info')));
  const status = h('div.microduck-status', {}, '等待舵机状态…');
  const poseSummary = h('div.microduck-pose', {}, '关节姿态尚无数据');
  const stageCard = card({ title: 'MicroDuck · 外观与姿态', sub: '按参考实机结构绘制；白色头壳、镜头、舵机连杆和脚壳随姿态同步' },
    canvasBox, status, poseSummary);

  const colorGrid = h('div.edition-grid');
  const customColor = h('input.input', { type: 'color', value: currentShellColor(), 'aria-label': '自定义鸭子机壳颜色' });
  const customLabel = h('label.field', {}, h('span.field-label', '自定义机壳色'), customColor);
  const resetColor = btn('恢复当前配色', { kind: 'outline', onClick: () => {
    resetCustomShellColor();
    customColor.value = currentShellColor();
    toast('已恢复所选主题机壳色', 'ok');
  } });
  const themeCard = card({ title: '选择一套配色', sub: '拓竹绿、工厂蓝、经典黄、午夜霓虹、复古红、纯白工作室' }, colorGrid,
    h('div.row.wrap', { style: { marginTop: '12px' } }, customLabel, resetColor));

  const imageInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
    onchange: async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      try {
        await setWallpaperFile(file);
        wallpaperState();
        toast('背景已保存在本机浏览器', 'ok');
      } catch (err) { toast(err.message || String(err), 'error'); }
      imageInput.value = '';
    } });
  const urlInput = h('input.input', { type: 'url', placeholder: 'https://example.com/background.jpg', 'aria-label': '背景图片网址' });
  const wallpaperText = h('div.hint-line', {});
  const opacityValue = h('span.kv-v.mono', {}, `${currentWallpaperOpacity()}%`);
  const opacityRange = h('input.input.wallpaper-opacity', {
    type: 'range', min: 0, max: 65, step: 1, value: currentWallpaperOpacity(),
    'aria-label': '页面背景图片透明度',
    oninput: () => {
      setWallpaperOpacity(opacityRange.value);
      opacityValue.textContent = `${opacityRange.value}%`;
    },
  });
  const wallpaperCard = card({ title: '页面背景', sub: '图片仅保存在当前浏览器；自定义图片建议宽边 1600px 以内、900KB 以下' },
    h('div.row.wrap', {}, btn('从设备选图', { onClick: () => imageInput.click() }), urlInput,
      btn('应用网址', { kind: 'outline', onClick: applyUrl }),
      btn('清除背景', { kind: 'ghost', onClick: () => { clearWallpaper(); wallpaperState(); toast('已清除背景图片', 'ok'); } })),
    h('label.field.wallpaper-opacity-field', {}, h('span.field-label', '背景图片透明度'),
      h('div.row', {}, opacityRange, opacityValue)),
    wallpaperText, imageInput);

  const pageEl = h('div.page.microduck-page', {},
    h('div.page-head', {}, h('div', {},
      h('h1.page-title', 'MicroDuck'),
      h('div.page-desc', '把 MicroDuck 的颜色、工作台背景和实时姿态集中在这里，选好主题后同步到总控与舵机页。')),
      h('div.page-head-actions', {}, btn('回总控', { onClick: () => ctx.go('/') }), btn('打开舵机', { onClick: () => ctx.go('/servos') }))),
    h('div.microduck-layout', {}, h('div.stack', {}, stageCard, wallpaperCard), h('div.stack', {}, themeCard,
      card({ title: '页面范围', sub: '选中主题会全局应用到这些界面' },
        h('div.microduck-scope', {},
          h('div.scope-item', {}, h('span.scope-mark.scope-stage'), h('span', {}, '总控舞台：复用当前真实姿态')),
          h('div.scope-item', {}, h('span.scope-mark.scope-duck'), h('span', {}, '舵机页：同步机壳色、关节强调色')),
          h('div.scope-item', {}, h('span.scope-mark.scope-ui'), h('span', {}, '其他页面：同步整体底色、边框和文字对比度')),
        ), h('div.note', {}, h('div', {}, '当前预览使用参考站的 MicroDuck CAD 三维网格；模型姿态跟随舵机状态，偏移与方向仍需上机标定后最终确认。'))))));

  el = { canvas, status, poseSummary, colorGrid, customColor, wallpaperText, urlInput };
  duck = createDuck(canvas, { mode: 'side', fill: 0.78 });
  renderEditions();
  wallpaperState();
  customColor.addEventListener('input', () => {
    try { setCustomShellColor(customColor.value); }
    catch (err) { toast(err.message || String(err), 'error'); }
  });
  return pageEl;
}

export function mount(ctx) {
  ctxRef = ctx;
  unsub = ctx.store.subscribe(() => paint(ctx));
  paint(ctx);
}

export function unmount() {
  unsub?.();
  unsub = null;
  duck?.destroy();
  duck = null;
  ctxRef = null;
  el = {};
}

function renderEditions() {
  const active = currentEdition().id;
  el.colorGrid.replaceChildren(...EDITIONS.map((item) => {
    const selected = item.id === active;
    const swatch = h('div.edition-swatch', { style: { '--swatch-shell': item.shell, '--swatch-edge': item.edge, '--swatch-shade': item.shade, '--swatch-accent': item.accent } },
      h('div.swatch-body'), h('div.swatch-head'), h('div.swatch-beak'), h('div.swatch-wing'), h('div.swatch-leg'));
    return h('button.edition-card', { type: 'button', 'aria-pressed': String(selected), onclick: () => {
      setEdition(item.id);
      el.customColor.value = currentShellColor();
      renderEditions();
      toast(`已应用「${item.name}」并同步总控、舵机与 MicroDuck`, 'ok');
    } }, swatch, h('span.edition-name', item.name), h('span.edition-line', item.line), selected ? chip('当前', 'ok') : null);
  }));
}

function paint(ctx) {
  const st = ctx.state() || {};
  const items = st.servos?.items || [];
  const omitted = Boolean(st.servos?.items_omitted);
  const posture = st.posture || '状态未知';
  duck?.setState(st);
  if (items.length) {
    const count = items.filter((item) => Number.isFinite(Number(item.pos))).length;
    el.status.textContent = `姿态已同步 · ${count}/15 颗舵机 · ${posture}`;
    el.poseSummary.textContent = `关节位置：${items.slice(0, 15).map((item) => `${item.id}:${Math.round(Number(item.pos) || 0)}`).join('  ')}`;
  } else {
    el.status.textContent = omitted ? '当前状态已省略舵机明细，切换到舵机页或等待全量状态。' : '没有实时舵机姿态；展示中位模型，不代表机器人当前动作。';
    el.poseSummary.textContent = `主控状态：${posture}`;
  }
}

async function applyUrl() {
  try {
    setWallpaperUrl(el.urlInput.value);
    wallpaperState();
    toast('背景地址已应用并保存在本机', 'ok');
  } catch (err) { toast(err.message || String(err), 'error'); }
}

function wallpaperState() {
  if (!el.wallpaperText) return;
  el.wallpaperText.textContent = hasWallpaper()
    ? '已启用自定义背景。深色/浅色蒙版会随主题调整。'
    : '当前使用主题默认背景。背景不会上传到主控。';
}
