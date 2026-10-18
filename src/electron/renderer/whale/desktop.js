'use strict';

// Preserve the original renderer's drag/press/flip, bubble, role/audio and
// editor behavior. Only report its actual surfaces to the native window.
const bridge = window.whaleDesktop;
let scheduled = false, dragging = false, last = '', frameBudget = 0;
const imageMasks = new WeakMap();

function visible(element) {
  for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function box(element) {
  const rect = element.getBoundingClientRect();
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

function imageRegions(img) {
  const rect = box(img);
  let cached = imageMasks.get(img);
  if (!cached || cached.src !== img.currentSrc) {
    if (!img.complete || !img.naturalWidth) return [rect];
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      cached = {src: img.currentSrc, rows: []};
      for (let y = 0; y < 64; y++) {
        let start = -1;
        for (let x = 0; x <= 64; x++) {
          const solid = x < 64 && data[(y * 64 + x) * 4 + 3] > 12;
          if (solid && start < 0) start = x;
          if (!solid && start >= 0) { cached.rows.push({x: start, y, width: x - start}); start = -1; }
        }
      }
      imageMasks.set(img, cached);
    } catch (_) { return [rect]; }
  }
  const flipped = img.closest('.dshwv-left') !== null;
  return cached.rows.map(row => ({x: rect.x + (flipped ? 64 - row.x - row.width : row.x) * rect.width / 64 - 1,
    y: rect.y + row.y * rect.height / 64 - 1, width: row.width * rect.width / 64 + 2, height: rect.height / 64 + 2}));
}

function sync() {
  scheduled = false;
  const rects = [];
  let editing = false;
  const root = document.querySelector('.dshwv-root');
  if (root) {
    for (const card of root.querySelectorAll('.dshwv-pop-open .whale-local-usage')) {
      window.whaleLocalUsage?.fitCard(card);
    }
    const menu = document.querySelector('.dshwv-menuview');
    if (menu && !menu.querySelector('.whale-monitor-links')) {
      const controls = document.createElement('div');
      controls.className = 'whale-monitor-links';
      for (const [text, action] of [['统计与账户', () => bridge.openMonitor()], ['切换显示器', () => bridge.nextDisplay()]]) {
        const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', action); controls.appendChild(button);
      }
      menu.prepend(controls);
    }
    for (const element of root.querySelectorAll('.dshwv-img,.dshwv-menu-btn,.dshwv-menu-open,.dshwv-pop-open')) {
      if (!visible(element)) continue;
      rects.push(...(element.matches('.dshwv-img') ? imageRegions(element) : [box(element)]));
    }
    if (dragging) rects.push(box(root));
  }
  for (const element of document.body.children) {
    if (element === root || element.id === 'root' || ['STYLE', 'SCRIPT'].includes(element.tagName) || !visible(element)) continue;
    rects.push(box(element));
    editing = true; // Menus also contain numeric/text fields.
  }
  const value = JSON.stringify({rects, editing});
  if (value !== last) { last = value; bridge.regions(rects, editing); }
  if (frameBudget-- > 0 || dragging) queue();
}

function queue() { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } }
new MutationObserver(() => { frameBudget = 20; queue(); }).observe(document.documentElement, {subtree: true, attributes: true, childList: true});
addEventListener('pointerdown', () => { dragging = true; frameBudget = 20; queue(); }, true);
addEventListener('pointerup', () => { dragging = false; frameBudget = 20; queue(); }, true);
addEventListener('pointercancel', () => { dragging = false; queue(); }, true);
addEventListener('resize', queue);
document.addEventListener('load', queue, true);
setInterval(queue, 1000);
queue();
