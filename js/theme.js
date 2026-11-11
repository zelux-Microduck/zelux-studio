/* 全局品牌主题与 MicroDuck 配色。偏好只存本机浏览器，不改硬件配置。 */

export const EDITIONS = [
  { id: 'atelier', name: '拓竹绿 · Studio', line: '鲜明绿 / 暖灰白', theme: 'atelier', brand: '#00AE42', shell: '#00AE42', edge: '#F1FFF4', shade: '#08742F', accent: '#FEC600', fill: 'rgba(0,174,66,.22)', wing: 'rgba(8,116,47,.20)', tint: 'rgba(245,246,242,.88)' },
  { id: 'factory-blue', name: '冰川蓝 · Signal', line: '冷调蓝 / 冰川白', theme: 'duckclub', brand: '#2367D1', shell: '#2367D1', edge: '#F0F6FF', shade: '#174EA9', accent: '#FEC600', fill: 'rgba(35,103,209,.23)', wing: 'rgba(23,78,169,.22)', tint: 'rgba(244,247,250,.88)' },
  { id: 'classic-yellow', name: '柠檬黄 · Citrus', line: '明亮黄 / 琥珀橙', theme: 'citrus', brand: '#D89500', shell: '#FEC600', edge: '#FFF9DC', shade: '#D89500', accent: '#F27B22', fill: 'rgba(254,198,0,.27)', wing: 'rgba(216,149,0,.22)', tint: 'rgba(250,247,238,.89)' },
  { id: 'midnight', name: '午夜青 · Night', line: '深空炭黑 / 荧光青', theme: 'midnight', brand: '#55E6BC', shell: '#55E6BC', edge: '#E7FFF8', shade: '#1CA982', accent: '#7CA7FF', fill: 'rgba(85,230,188,.25)', wing: 'rgba(28,169,130,.22)', tint: 'rgba(17,22,27,.76)' },
  { id: 'retro-red', name: '陶土红 · Terra', line: '陶土红 / 奶油白', theme: 'terra', brand: '#C84D32', shell: '#C84D32', edge: '#FFF3ED', shade: '#8D2F22', accent: '#F2B84B', fill: 'rgba(200,77,50,.22)', wing: 'rgba(141,47,34,.20)', tint: 'rgba(249,245,241,.89)' },
  { id: 'white-studio', name: '瓷白 · Porcelain', line: '瓷白 / 石墨蓝', theme: 'porcelain', brand: '#2367D1', shell: '#FFFFFF', edge: '#DDE4EB', shade: '#97A4B1', accent: '#2367D1', fill: 'rgba(255,255,255,.94)', wing: 'rgba(200,210,220,.45)', tint: 'rgba(246,248,250,.91)' },
];

const EDITION_KEY = 'zelux-edition-v2';
const WALL_KEY = 'zelux-wallpaper-v2';
const SHELL_KEY = 'zelux-shell-color-v2';
const WALL_OPACITY_KEY = 'zelux-wallpaper-opacity-v2';
let edition = 'atelier';
let wallpaper = '';
let customShell = '';
let wallpaperOpacity = null;

export function currentEdition() {
  return EDITIONS.find((item) => item.id === edition) || EDITIONS[0];
}

export function currentShellColor() {
  return customShell || currentEdition().shell;
}

export function initTheme() {
  try {
    const savedEdition = localStorage.getItem(EDITION_KEY) || 'atelier';
    edition = EDITIONS.some((item) => item.id === savedEdition) ? savedEdition : 'atelier';
    wallpaper = localStorage.getItem(WALL_KEY) || '';
    const savedShell = localStorage.getItem(SHELL_KEY) || '';
    customShell = /^#[0-9a-fA-F]{6}$/.test(savedShell) ? savedShell : '';
    const rawOpacity = localStorage.getItem(WALL_OPACITY_KEY);
    if (rawOpacity === null) {
      wallpaperOpacity = null;
    } else {
      const savedOpacity = Number(rawOpacity);
      wallpaperOpacity = Number.isFinite(savedOpacity) ? Math.max(0, Math.min(0.65, savedOpacity)) : null;
    }
  } catch { /* 隐私窗口禁用存储时仍可在本次运行中使用 */ }
  applyEdition();
  applyWallpaper();
}

export function setEdition(id) {
  if (!EDITIONS.some((item) => item.id === id)) return false;
  edition = id;
  customShell = '';
  try {
    localStorage.setItem(EDITION_KEY, id);
    localStorage.removeItem(SHELL_KEY);
  } catch { /* 本次会话仍生效 */ }
  applyEdition();
  applyWallpaper();
  return true;
}

export function setCustomShellColor(value) {
  const color = String(value || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('颜色需要是 6 位 HEX，例如 #00AE42。');
  customShell = color;
  try { localStorage.setItem(SHELL_KEY, color); } catch { /* 本次会话仍可预览 */ }
  applyEdition();
}

export function resetCustomShellColor() {
  customShell = '';
  try { localStorage.removeItem(SHELL_KEY); } catch { /* 本次会话仍可恢复默认 */ }
  applyEdition();
}

export async function setWallpaperFile(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
  if (file.size > 900 * 1024) throw new Error('背景图片请小于 900 KB，避免浏览器本地存储不足。');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取背景图片失败。'));
    reader.readAsDataURL(file);
  });
  saveWallpaper(dataUrl);
}

export function setWallpaperUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) { clearWallpaper(); return; }
  let url;
  try { url = new URL(raw); } catch { throw new Error('请输入完整的 http:// 或 https:// 图片地址。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('背景地址只支持 http 或 https。');
  saveWallpaper(url.href);
}

export function clearWallpaper() {
  wallpaper = '';
  try { localStorage.removeItem(WALL_KEY); } catch { /* 本次会话仍可清空 */ }
  applyWallpaper();
}

export function setWallpaperOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) throw new Error('背景透明度需要是 0 到 65 之间的数字。');
  wallpaperOpacity = Math.max(0, Math.min(0.65, opacity / 100));
  try { localStorage.setItem(WALL_OPACITY_KEY, String(wallpaperOpacity)); } catch { /* 仅当前运行应用 */ }
  applyWallpaper();
}

export function currentWallpaperOpacity() {
  return wallpaperOpacity == null ? 16 : Math.round(wallpaperOpacity * 100);
}

export function hasWallpaper() {
  return Boolean(wallpaper);
}

function saveWallpaper(value) {
  wallpaper = value;
  try { localStorage.setItem(WALL_KEY, value); }
  catch {
    wallpaper = '';
    applyWallpaper();
    throw new Error('浏览器本地存储空间不足，请改用较小图片。');
  }
  applyWallpaper();
}

function applyEdition() {
  const item = currentEdition();
  const root = document.documentElement;
  root.dataset.theme = item.theme;
  root.dataset.edition = item.id;
  const dark = item.theme === 'midnight';
  root.style.setProperty('--brand', item.brand);
  root.style.setProperty('--brand-600', darken(item.brand, dark ? 0.08 : 0.14));
  root.style.setProperty('--brand-ink', dark ? item.brand : darken(item.brand, 0.39));
  root.style.setProperty('--brand-050', hexRgba(item.brand, dark ? 0.13 : 0.08));
  root.style.setProperty('--brand-100', hexRgba(item.brand, dark ? 0.22 : 0.18));
  const shell = customShell || item.shell;
  root.style.setProperty('--duck-shell', shell);
  // 参考实机的头壳与躯干保持白色，主题色用于脚壳、关节强调和界面品牌色。
  root.style.setProperty('--duck-surface', dark ? '#DCE8E3' : '#F5F5F1');
  root.style.setProperty('--duck-edge', item.edge);
  root.style.setProperty('--duck-shade', item.shade);
  root.style.setProperty('--duck-accent', item.accent);
  root.style.setProperty('--duck-shell-fill', customShell ? hexRgba(shell, 0.23) : item.fill);
  root.style.setProperty('--duck-wing-fill', customShell ? hexRgba(shell, 0.19) : item.wing);
  root.style.setProperty('--wallpaper-tint', item.tint);
  window.dispatchEvent(new Event('zelux-theme-change'));
}

function hexRgba(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function darken(hex, amount) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function applyWallpaper() {
  const root = document.documentElement;
  if (!wallpaper) {
    root.style.removeProperty('--page-wallpaper');
    root.style.removeProperty('--wallpaper-opacity');
    return;
  }
  const alpha = wallpaperOpacity == null ? 0.16 : wallpaperOpacity;
  root.style.setProperty('--wallpaper-opacity', String(alpha));
  root.style.setProperty('--page-wallpaper', `url(${JSON.stringify(wallpaper)})`);
}
