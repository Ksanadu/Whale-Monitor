'use strict';

// BrowserWindow.setShape consumes logical pixels. Keep renderer input bounded
// and clipped even when a display is unplugged or a custom role is enormous.
function sanitizeRegions(regions, bounds) {
  if (!Array.isArray(regions)) return [];
  return regions.slice(0, 1024).flatMap(rect => {
    if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) return [];
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(bounds.width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(bounds.height, Math.ceil(rect.y + rect.height));
    return right > x && bottom > y ? [{x, y, width: right - x, height: bottom - y}] : [];
  });
}

module.exports = {sanitizeRegions};
