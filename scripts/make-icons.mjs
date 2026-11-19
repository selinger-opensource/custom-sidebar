// Draws the toolbar/extension icon (a window with a side panel) as PNGs in extension/icons/.
// Pure Node, no image libraries: shapes are rasterised with 4×4 supersampling and written with
// zlib. Run once after changing the drawing; the PNGs are committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Shapes on a 128-unit canvas: [x0, y0, x1, y1, radius, [r, g, b, a]].
const SHAPES = [
  [8, 8, 120, 120, 26, [26, 115, 232, 255]], // tile
  [26, 28, 58, 100, 7, [255, 255, 255, 255]], // the side panel
  [68, 36, 102, 46, 5, [255, 255, 255, 190]], // rows
  [68, 59, 96, 69, 5, [255, 255, 255, 190]],
  [68, 82, 102, 92, 5, [255, 255, 255, 190]],
];

const inside = ([x0, y0, x1, y1, r], x, y) => {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function draw(size) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) * 128) / size;
          const uy = ((y + (sy + 0.5) / SS) * 128) / size;
          let c = [0, 0, 0, 0]; // straight-alpha "over" compositing, shape by shape
          for (const s of SHAPES) {
            if (!inside(s, ux, uy)) continue;
            const [sr, sg, sb, sa] = s[5].map((v, i) => (i < 3 ? v : v / 255));
            const outA = sa + c[3] * (1 - sa);
            c = outA === 0 ? [0, 0, 0, 0] : [
              (sr * sa + c[0] * c[3] * (1 - sa)) / outA,
              (sg * sa + c[1] * c[3] * (1 - sa)) / outA,
              (sb * sa + c[2] * c[3] * (1 - sa)) / outA,
              outA,
            ];
          }
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i + 3] = Math.round((a / n) * 255);
      if (a > 0) [px[i], px[i + 1], px[i + 2]] = [r / a, g / a, b / a].map(Math.round);
    }
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("extension/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`extension/icons/icon-${size}.png`, draw(size));
console.log("wrote extension/icons/icon-{16,32,48,128}.png");
