// Generates icons/icon{16,32,48,128}.png (play button with a slash) using only node built-ins.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZES = [16, 32, 48, 128];
const RED = [204, 32, 32];
const WHITE = [255, 255, 255];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function roundRectDist(u, v, r) {
  const qx = Math.abs(u - 0.5) - (0.5 - r);
  const qy = Math.abs(v - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Convex polygon (clockwise on screen, y down): max signed distance to the edge half-planes, negative inside.
function polygonDist(u, v, pts) {
  let d = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    d = Math.max(d, ((u - ax) * (by - ay) - (v - ay) * (bx - ax)) / len);
  }
  return d;
}

function segmentDist(u, v, [ax, ay], [bx, by]) {
  const t = clamp01(((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(u - ax - t * (bx - ax), v - ay - t * (by - ay));
}

function pixel(x, y, size) {
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const cov = (d) => clamp01(0.5 - d * size);
  const slash = segmentDist(u, v, [0.22, 0.78], [0.78, 0.22]);
  let rgb = RED;
  rgb = lerp(rgb, WHITE, cov(polygonDist(u, v, [[0.38, 0.28], [0.74, 0.5], [0.38, 0.72]])));
  rgb = lerp(rgb, RED, cov(slash - 0.085)); // gap so the slash reads against the triangle
  rgb = lerp(rgb, WHITE, cov(slash - 0.04));
  return [...rgb.map(Math.round), Math.round(255 * cov(roundRectDist(u, v, 0.22)))];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0); // filter: none
    for (let x = 0; x < size; x++) rows.push(...pixel(x, y, size));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size));
console.log(`Wrote ${SIZES.length} icons to ${outDir}`);
