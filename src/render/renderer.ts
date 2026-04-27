import createREGL from 'regl';
import type { Regl, DrawCommand, Buffer } from 'regl';
import { MAX_AGENTS, WORLD_SIZE } from '../sim/constants';

export interface View {
  centerX: number;
  centerY: number;
  zoom: number; // pixels per world unit
}

export interface Renderer {
  draw(frame: Float32Array, count: number, view: View): void;
  resize(): void;
  destroy(): void;
}

// Frame layout per agent: [x, y, beliefId] — 3 floats, stride 12 bytes.
const FRAME_STRIDE = 12;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const regl: Regl = createREGL({
    canvas,
    attributes: { antialias: false, premultipliedAlpha: false },
  });

  const frameBuffer: Buffer = regl.buffer({
    usage: 'dynamic',
    type: 'float',
    length: MAX_AGENTS * FRAME_STRIDE,
  });

  const draw: DrawCommand = regl({
    vert: `
      precision highp float;
      attribute vec2 pos;
      attribute float belief;
      uniform vec2 center;
      uniform vec2 viewport;
      uniform float zoom;
      uniform float pointSize;
      uniform float world;
      varying vec3 vColor;

      // Hash belief id → hue, deterministic.
      float hash1(float n) {
        return fract(sin(n * 43758.5453) * 12345.6789);
      }
      vec3 hsl2rgb(float h, float s, float l) {
        vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
        vec3 a = vec3(s * min(l, 1.0 - l));
        return l - a * clamp(min(k - 3.0, 9.0 - k) - 1.0, -1.0, 1.0);
      }

      void main() {
        // Torus wrap: draw in the image of the world nearest to the view center.
        vec2 d = pos - center;
        d -= world * floor(d / world + 0.5);
        vec2 screen = d * zoom / (viewport * 0.5);
        gl_Position = vec4(screen, 0.0, 1.0);

        if (belief < 0.5) {
          // Non-believers: faint grey, stay at base size (shrink a touch when zoomed out).
          vColor = vec3(0.32, 0.32, 0.36);
          gl_PointSize = max(1.0, pointSize * 0.85);
        } else {
          // Believers: larger minimum size so they stay visible at low zoom,
          // and a bright saturated hue that pops against the grey field.
          float h = hash1(belief + 1.7);
          vColor = hsl2rgb(h, 0.9, 0.62);
          gl_PointSize = max(pointSize + 1.5, 3.0);
        }
      }
    `,
    frag: `
      precision mediump float;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
    attributes: {
      pos: { buffer: frameBuffer, offset: 0, stride: FRAME_STRIDE },
      belief: { buffer: frameBuffer, offset: 8, stride: FRAME_STRIDE },
    },
    uniforms: {
      center: regl.prop<{ center: [number, number] }, 'center'>('center'),
      viewport: regl.prop<{ viewport: [number, number] }, 'viewport'>('viewport'),
      zoom: regl.prop<{ zoom: number }, 'zoom'>('zoom'),
      pointSize: regl.prop<{ pointSize: number }, 'pointSize'>('pointSize'),
      world: WORLD_SIZE,
    },
    count: regl.prop<{ count: number }, 'count'>('count'),
    primitive: 'points',
    depth: { enable: false },
    blend: {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' },
    },
  });

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function drawFrame(frame: Float32Array, count: number, view: View): void {
    if (count === 0) return;
    frameBuffer.subdata(frame.subarray(0, count * 3), 0);
    regl.clear({ color: [0.06, 0.07, 0.09, 1], depth: 1 });
    const pointSize = Math.max(1.5, view.zoom * 0.6);
    draw({
      center: [view.centerX, view.centerY],
      viewport: [canvas.width, canvas.height],
      zoom: view.zoom,
      pointSize,
      count,
    });
  }

  return {
    draw: drawFrame,
    resize,
    destroy: () => regl.destroy(),
  };
}
