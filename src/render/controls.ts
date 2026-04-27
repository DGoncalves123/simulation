import { WORLD_SIZE } from '../sim/constants';
import type { View } from './renderer';

// Note on coordinate systems:
// - View.zoom is pixels-per-world-unit in *device* pixels (canvas backing store).
// - Mouse events deliver CSS pixels.
// - So CSS-px-to-world = 1 / (zoom / dpr) = dpr / zoom.
// Keep conversions in one place to avoid drift.

export function attachPanZoom(canvas: HTMLCanvasElement, view: View): () => void {
  let dragging = false;
  let lastCssX = 0;
  let lastCssY = 0;

  const dpr = () => window.devicePixelRatio || 1;

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastCssX = e.clientX;
    lastCssY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    // Move the world 1:1 with CSS pixels: dragging right by 10 CSS px should
    // move the view left by exactly 10 CSS px worth of world.
    const dxCss = e.clientX - lastCssX;
    const dyCss = e.clientY - lastCssY;
    lastCssX = e.clientX;
    lastCssY = e.clientY;
    const zoomCss = view.zoom / dpr();
    view.centerX -= dxCss / zoomCss;
    view.centerY -= dyCss / zoomCss;
    view.centerX = ((view.centerX % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
    view.centerY = ((view.centerY % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();

    // Normalise delta across deltaModes (pixel / line / page).
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 16;      // lines → px
    else if (e.deltaMode === 2) deltaY *= 100; // pages → px

    const factor = Math.exp(-deltaY * 0.0035);
    const newZoom = Math.max(0.05, Math.min(400, view.zoom * factor));
    if (newZoom === view.zoom) return;

    // Zoom around the cursor: keep the world point under the cursor fixed.
    const rect = canvas.getBoundingClientRect();
    const cssOffsetX = e.clientX - rect.left - rect.width / 2;
    const cssOffsetY = e.clientY - rect.top - rect.height / 2;
    const d = dpr();
    const oldZoomCss = view.zoom / d;
    const newZoomCss = newZoom / d;
    // World point under cursor before zoom:
    const wx = view.centerX + cssOffsetX / oldZoomCss;
    const wy = view.centerY + cssOffsetY / oldZoomCss;
    // After zoom, pin it by adjusting center.
    view.centerX = wx - cssOffsetX / newZoomCss;
    view.centerY = wy - cssOffsetY / newZoomCss;
    view.zoom = newZoom;
    view.centerX = ((view.centerX % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
    view.centerY = ((view.centerY % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
