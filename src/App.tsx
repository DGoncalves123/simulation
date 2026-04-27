import { useEffect, useRef, useState } from 'react';
import { INITIAL_AGENTS, WORLD_SIZE } from './sim/constants';
import { createRenderer, type View } from './render/renderer';
import { attachPanZoom } from './render/controls';
import { Tooltip } from './ui/Tooltip';
import type { MainToWorker, QueryResult, WorkerToMain } from './workers/protocol';

const HOVER_SCREEN_RADIUS_CSS = 16; // CSS pixels — group aggregation radius
const SNAP_SCREEN_RADIUS_CSS = 36; // CSS pixels — how far the cursor will snap to a believer

interface HoverState {
  screenX: number;
  screenY: number;
  result: QueryResult;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState({ fps: 0, tps: 0, count: 0, tick: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createRenderer(canvas);
    renderer.resize();

    const fitZoom = Math.min(canvas.width, canvas.height) / WORLD_SIZE;
    const view: View = {
      centerX: WORLD_SIZE / 2,
      centerY: WORLD_SIZE / 2,
      zoom: fitZoom,
    };
    const detachControls = attachPanZoom(canvas, view);

    const worker = new Worker(new URL('./workers/sim.worker.ts', import.meta.url), {
      type: 'module',
    });

    const send = (msg: MainToWorker, transfer?: Transferable[]) =>
      worker.postMessage(msg, transfer ?? []);

    const bufBytes = 1_000_000 * 4 * 4;
    const bufA = new ArrayBuffer(bufBytes);
    const bufB = new ArrayBuffer(bufBytes);

    let latestFrame: Float32Array | null = null;
    let latestCount = 0;
    let pendingReturn: ArrayBuffer | null = null;

    let framesInWindow = 0;
    let lastFpsAt = performance.now();
    let fps = 0;
    let tps = 0;
    let tick = 0;

    // Hover/query state (kept in refs/local to avoid rerenders on every frame).
    let mouseCssX = -1;
    let mouseCssY = -1;
    let mouseOverCanvas = false;
    let dragging = false;
    let nextQueryId = 1;
    let lastQuerySentAt = 0;
    let latestQueryId = 0; // stale-response guard

    worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        send({ type: 'frameBuffer', buffer: bufA }, [bufA]);
        send({ type: 'frameBuffer', buffer: bufB }, [bufB]);
        send({ type: 'start' });
        setStats((s) => ({ ...s, count: msg.count }));
      } else if (msg.type === 'frame') {
        if (pendingReturn) {
          send({ type: 'frameBuffer', buffer: pendingReturn }, [pendingReturn]);
        }
        latestFrame = new Float32Array(msg.buffer, 0, msg.count * 4);
        latestCount = msg.count;
        pendingReturn = msg.buffer;
        tps = msg.tps;
        tick = msg.tick;
      } else if (msg.type === 'queryResult') {
        if (msg.result.id !== latestQueryId) return; // stale
        if (!mouseOverCanvas || dragging) return;
        setHover({
          screenX: mouseCssX,
          screenY: mouseCssY,
          result: msg.result,
        });
      }
    };

    send({ type: 'init', agents: INITIAL_AGENTS, seed: 1 });

    // Translate CSS mouse → world coords, accounting for DPR and view transform.
    const cssToWorld = (cssX: number, cssY: number): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const cx = cssX - rect.left - rect.width / 2;
      const cy = cssY - rect.top - rect.height / 2;
      // view.zoom is pixels-per-world-unit in *device* pixels; rect is CSS px.
      const dpr = window.devicePixelRatio || 1;
      const zoomCss = view.zoom / dpr;
      let wx = view.centerX + cx / zoomCss;
      let wy = view.centerY + cy / zoomCss;
      wx = ((wx % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
      wy = ((wy % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
      return { x: wx, y: wy };
    };

    // Snap using the rendered-frame positions so the choice matches what the
    // user sees. Returns the agent's original state index, or -1.
    const snapAgainstFrame = (worldX: number, worldY: number, snapR: number): number => {
      if (!latestFrame || latestCount === 0) return -1;
      const r2 = snapR * snapR;
      const halfW = WORLD_SIZE * 0.5;
      let best = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < latestCount; i++) {
        const o = i * 4;
        const belief = latestFrame[o + 2];
        if (belief < 0.5) continue; // non-believers don't snap
        let dx = latestFrame[o] - worldX;
        let dy = latestFrame[o + 1] - worldY;
        if (dx > halfW) dx -= WORLD_SIZE;
        else if (dx < -halfW) dx += WORLD_SIZE;
        if (dy > halfW) dy -= WORLD_SIZE;
        else if (dy < -halfW) dy += WORLD_SIZE;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && d2 < bestD2) {
          bestD2 = d2;
          best = latestFrame[o + 3] | 0;
        }
      }
      return best;
    };

    const maybeQuery = () => {
      if (!mouseOverCanvas || dragging) return;
      const now = performance.now();
      if (now - lastQuerySentAt < 50) return;
      lastQuerySentAt = now;
      const { x, y } = cssToWorld(mouseCssX, mouseCssY);
      const dpr = window.devicePixelRatio || 1;
      const zoomCss = view.zoom / dpr;
      const worldRadius = HOVER_SCREEN_RADIUS_CSS / zoomCss;
      const worldSnapRadius = SNAP_SCREEN_RADIUS_CSS / zoomCss;
      const snapped = snapAgainstFrame(x, y, worldSnapRadius);
      latestQueryId = nextQueryId++;
      send({
        type: 'query',
        id: latestQueryId,
        x, y,
        radius: worldRadius,
        snapRadius: worldSnapRadius,
        limit: 0,
        ...(snapped >= 0 ? { snappedAgent: snapped } : {}),
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseCssX = e.clientX;
      mouseCssY = e.clientY;
      mouseOverCanvas = true;
      if (dragging) setHover(null);
      else maybeQuery();
    };
    const onMouseLeave = () => {
      mouseOverCanvas = false;
      setHover(null);
    };
    const onPointerDown = () => {
      dragging = true;
      setHover(null);
    };
    const onPointerUp = () => {
      dragging = false;
      maybeQuery();
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', () => {
      // Zoom changes radius — reissue query.
      setTimeout(maybeQuery, 0);
    }, { passive: true });

    let raf = 0;
    const frame = () => {
      renderer.resize();
      if (latestFrame) {
        renderer.draw(latestFrame, latestCount, view);
      }
      framesInWindow++;
      const now = performance.now();
      if (now - lastFpsAt > 500) {
        fps = (framesInWindow * 1000) / (now - lastFpsAt);
        framesInWindow = 0;
        lastFpsAt = now;
        setStats({ fps, tps, count: latestCount, tick });
      }
      // Keep the tooltip live as the sim moves under the cursor.
      maybeQuery();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      detachControls();
      worker.terminate();
      renderer.destroy();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1115', color: '#ddd' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor: 'grab',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 6,
          lineHeight: 1.5,
        }}
      >
        <div>agents: {stats.count.toLocaleString()}</div>
        <div>fps: {stats.fps.toFixed(0)}</div>
        <div>tps: {stats.tps.toFixed(0)}</div>
        <div>tick: {stats.tick.toLocaleString()}</div>
        <div style={{ opacity: 0.6, marginTop: 4 }}>drag to pan · wheel to zoom · hover for beliefs</div>
      </div>
      {hover && (
        <Tooltip screenX={hover.screenX} screenY={hover.screenY} result={hover.result} />
      )}
    </div>
  );
}
