import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tempDir = join(root, '.preview-frames');
const outputDir = join(root, 'docs', 'previews');
const styles = ['siri', 'orbit', 'ring', 'pulse', 'dots', 'bars', 'wave', 'halo', 'around', 'lottie', 'image'];
const frameCount = 24;
const width = 320;
const height = 200;
const colors = ['#71f6ff', '#8b5cf6', '#ff4ecd', '#fff7ad'].map(hex);

mkdirSync(outputDir, { recursive: true });
rmSync(tempDir, { force: true, recursive: true });
mkdirSync(tempDir, { recursive: true });

for (const style of styles) {
  const styleDir = join(tempDir, style);
  mkdirSync(styleDir, { recursive: true });

  for (let frame = 0; frame < frameCount; frame += 1) {
    const canvas = new Raster(width, height);
    const t = frame / frameCount;
    drawBackground(canvas, style);
    drawStyle(canvas, style, t);
    writeFileSync(join(styleDir, `${String(frame).padStart(3, '0')}.ppm`), canvas.toPPM());
  }

  execFileSync('magick', ['-delay', '6', '-loop', '0', join(styleDir, '*.ppm'), join(outputDir, `${style}.webp`)], {
    stdio: 'ignore',
  });
}

rmSync(tempDir, { force: true, recursive: true });

class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
  }

  fill(color) {
    for (let index = 0; index < this.data.length; index += 3) {
      this.data[index] = color.r;
      this.data[index + 1] = color.g;
      this.data[index + 2] = color.b;
    }
  }

  blendPixel(x, y, color, alpha = 1) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const offset = (iy * this.w + ix) * 3;
    this.data[offset] = mix(this.data[offset], color.r, alpha);
    this.data[offset + 1] = mix(this.data[offset + 1], color.g, alpha);
    this.data[offset + 2] = mix(this.data[offset + 2], color.b, alpha);
  }

  circle(cx, cy, radius, color, alpha = 1) {
    const minX = Math.floor(cx - radius);
    const maxX = Math.ceil(cx + radius);
    const minY = Math.floor(cy - radius);
    const maxY = Math.ceil(cy + radius);
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const edge = Math.min(1, (r2 - d2) / Math.max(radius, 1));
          this.blendPixel(x, y, color, alpha * Math.min(1, edge + 0.2));
        }
      }
    }
  }

  rect(x, y, w, h, color, alpha = 1) {
    for (let iy = Math.max(0, y); iy < Math.min(this.h, y + h); iy += 1) {
      for (let ix = Math.max(0, x); ix < Math.min(this.w, x + w); ix += 1) {
        this.blendPixel(ix, iy, color, alpha);
      }
    }
  }

  roundedRect(x, y, w, h, r, color, alpha = 1) {
    this.rect(x + r, y, w - 2 * r, h, color, alpha);
    this.rect(x, y + r, w, h - 2 * r, color, alpha);
    this.circle(x + r, y + r, r, color, alpha);
    this.circle(x + w - r, y + r, r, color, alpha);
    this.circle(x + r, y + h - r, r, color, alpha);
    this.circle(x + w - r, y + h - r, r, color, alpha);
  }

  line(points, thickness, color, alpha = 1) {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const next = points[i];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
      for (let step = 0; step <= steps; step += 1) {
        const p = step / steps;
        this.circle(prev.x + dx * p, prev.y + dy * p, thickness / 2, color, alpha);
      }
    }
  }

  ring(cx, cy, radius, thickness, start, sweep, palette, alpha = 1) {
    const steps = Math.max(24, Math.ceil(Math.abs(sweep) / 4));
    for (let step = 0; step <= steps; step += 1) {
      const p = step / steps;
      const angle = ((start + sweep * p) * Math.PI) / 180;
      const color = palette[Math.floor(p * (palette.length - 1))];
      this.circle(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, thickness / 2, color, alpha);
    }
  }

  toPPM() {
    return Buffer.concat([Buffer.from(`P6\n${this.w} ${this.h}\n255\n`), Buffer.from(this.data)]);
  }
}

function drawBackground(canvas, style) {
  canvas.fill(hex('#070912'));
  canvas.circle(50, 180, 90, hex('#162032'), 0.75);
  canvas.circle(260, 170, 85, hex('#121b2b'), 0.82);
  if (style !== 'around') {
    canvas.roundedRect(96, 34, 128, 128, 26, hex('#141927'), 0.92);
    canvas.roundedRect(97, 35, 126, 126, 24, hex('#1f2638'), 0.28);
  }
}

function drawStyle(canvas, style, t) {
  switch (style) {
    case 'siri':
      drawSiri(canvas, t);
      break;
    case 'orbit':
      drawOrbit(canvas, t);
      break;
    case 'ring':
      drawRing(canvas, t);
      break;
    case 'pulse':
      drawPulse(canvas, t);
      break;
    case 'dots':
      drawDots(canvas, t);
      break;
    case 'bars':
      drawBars(canvas, t);
      break;
    case 'wave':
      drawWave(canvas, t);
      break;
    case 'halo':
      drawHalo(canvas, t);
      break;
    case 'around':
      drawAround(canvas, t);
      break;
    case 'lottie':
      drawLottie(canvas, t);
      break;
    case 'image':
      drawImage(canvas, t);
      break;
  }
}

function drawSiri(canvas, t) {
  colors.forEach((color, index) => {
    const angle = t * Math.PI * 2 + (index * Math.PI) / 2;
    const x = 160 + Math.cos(angle) * 12;
    const y = 98 + Math.sin(angle * 1.15) * 12;
    const r = 29 + Math.sin(angle + index) * 7;
    canvas.circle(x, y, r + 9, color, 0.12);
    canvas.circle(x, y, r, color, 0.56);
  });
  canvas.ring(160, 98, 40, 2, 0, 360, [hex('#ffffff')], 0.2);
}

function drawOrbit(canvas, t) {
  canvas.ring(160, 98, 42, 4, 0, 360, [colors[0]], 0.16);
  for (let index = 0; index < 6; index += 1) {
    const angle = t * Math.PI * 2 + (index * Math.PI) / 3;
    canvas.circle(160 + Math.cos(angle) * 42, 98 + Math.sin(angle) * 42, 7, colors[index % colors.length], 0.42 + index * 0.08);
  }
}

function drawRing(canvas, t) {
  canvas.ring(160, 98, 42, 7, 0, 360, [colors[0]], 0.12);
  canvas.ring(160, 98, 42, 7, -90 + t * 360, 260, colors, 0.95);
}

function drawPulse(canvas, t) {
  for (let index = 0; index < 4; index += 1) {
    const phase = (t + index * 0.18) % 1;
    canvas.ring(160, 98, 10 + phase * 48, 5, 0, 360, [colors[index % colors.length]], 1 - phase);
  }
}

function drawDots(canvas, t) {
  for (let index = 0; index < 3; index += 1) {
    const signal = Math.sin(t * Math.PI * 2 + index * 0.8);
    canvas.circle(138 + index * 22, 98 + signal * 14, 8, colors[index], 0.55 + ((signal + 1) / 2) * 0.45);
  }
}

function drawBars(canvas, t) {
  for (let index = 0; index < 5; index += 1) {
    const signal = (Math.sin(t * Math.PI * 2 + index * 0.72) + 1) / 2;
    const h = 24 + signal * 52;
    canvas.roundedRect(128 + index * 16, 98 - h / 2, 8, h, 4, colors[index % colors.length], 0.92);
  }
}

function drawWave(canvas, t) {
  const points = [];
  for (let index = 0; index < 54; index += 1) {
    const x = 106 + index * 4;
    const progress = index / 53;
    points.push({ x, y: 98 + Math.sin(progress * Math.PI * 2 + t * Math.PI * 2) * 22 });
  }
  canvas.line(points, 7, colors[0], 0.95);
  canvas.line(points.slice(10, 44), 5, colors[2], 0.65);
}

function drawHalo(canvas, t) {
  canvas.ring(160, 98, 38, 20, t * 360, 360, colors, 0.55);
  canvas.circle(160, 98, 28, hex('#111827'), 0.92);
  canvas.ring(160, 98, 43, 2, 0, 360, [hex('#ffffff')], 0.14);
}

function drawAround(canvas, t) {
  canvas.roundedRect(18, 18, 284, 150, 24, hex('#111827'), 0.28);
  canvas.ring(160, 93, 112, 7, t * 360 - 90, 120, colors, 0.9);
  canvas.line(
    [
      { x: 42, y: 26 },
      { x: 278, y: 26 },
      { x: 294, y: 42 },
      { x: 294, y: 144 },
      { x: 278, y: 160 },
      { x: 42, y: 160 },
      { x: 26, y: 144 },
      { x: 26, y: 42 },
      { x: 42, y: 26 },
    ],
    5,
    colors[Math.floor(t * colors.length) % colors.length],
    0.24,
  );
}

function drawLottie(canvas, t) {
  const angle = t * Math.PI * 2;
  const points = [
    rotatePoint(160, 54, 160, 98, angle),
    rotatePoint(206, 98, 160, 98, angle),
    rotatePoint(160, 142, 160, 98, angle),
    rotatePoint(114, 98, 160, 98, angle),
    rotatePoint(160, 54, 160, 98, angle),
  ];
  canvas.line(points, 16, colors[1], 0.82);
  canvas.line(points, 8, colors[0], 0.72);
  canvas.circle(160, 98, 18, hex('#070912'), 0.95);
}

function drawImage(canvas, t) {
  const y = 98 + Math.sin(t * Math.PI * 2) * 10;
  canvas.roundedRect(124, y - 36, 72, 72, 18, colors[0], 0.75);
  canvas.roundedRect(130, y - 30, 60, 60, 14, colors[2], 0.45);
  canvas.circle(178, y - 18, 6, colors[3], 0.95);
  canvas.line(
    [
      { x: 140, y: y + 10 },
      { x: 152, y: y - 4 },
      { x: 166, y: y + 12 },
      { x: 178, y },
      { x: 190, y: y + 18 },
    ],
    5,
    hex('#07111f'),
    0.9,
  );
}

function rotatePoint(x, y, cx, cy, angle) {
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function hex(value) {
  const raw = value.replace('#', '');
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function mix(a, b, alpha) {
  return Math.max(0, Math.min(255, Math.round(a * (1 - alpha) + b * alpha)));
}
