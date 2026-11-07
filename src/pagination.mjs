// Chromium rounds scroll offsets to physical pixels. Always derive the next
// position from the page grid instead of accumulating rounded scrollBy values.
export function pageTurnTarget(position, viewportWidth, contentWidth, step, direction) {
  const tolerance = 1; // CSS pixel: covers physical-pixel rounding at Windows DPI scales.
  const end = Math.max(0, contentWidth - viewportWidth);
  if (!(step > 0)) return null;
  if (direction > 0) {
    if (end - position <= tolerance) return null;
    return Math.min(end, (Math.floor((position + tolerance) / step) + 1) * step);
  }
  if (position <= tolerance) return null;
  return Math.max(0, (Math.ceil((position - tolerance) / step) - 1) * step);
}
