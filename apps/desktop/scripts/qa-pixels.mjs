/**
 * Minimal PNG reader for visual QA assertions.
 *
 * `screencapture` writes 8-bit non-interlaced PNGs; this decodes that subset
 * (all five filter types) so a check can compare real pixels instead of eyeballing
 * a screenshot. Used to prove that a window's material is compositing what is
 * behind it: the same chrome over a light and a dark backdrop must differ.
 *
 * Usage:
 *   node scripts/qa-pixels.mjs <file.png> <x> <y> <w> <h>
 *     → prints "avg=#rrggbb brightness=0.42"
 *   node scripts/qa-pixels.mjs --diff <a.png> <b.png> <x> <y> <w> <h>
 *     → prints both averages and their brightness delta
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decodePng(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      if (bitDepth !== 8) throw new Error(`${file}: only 8-bit PNGs are supported`);
      if (data.readUInt8(12) !== 0) throw new Error(`${file}: interlaced PNGs are not supported`);
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      const value = line[x];
      switch (filter) {
        case 0: current[x] = value; break;
        case 1: current[x] = (value + left) & 0xff; break;
        case 2: current[x] = (value + up) & 0xff; break;
        case 3: current[x] = (value + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          current[x] = (value + predictor) & 0xff;
          break;
        }
        default: throw new Error(`${file}: unknown filter type ${filter}`);
      }
    }
  }
  return { width, height, channels, pixels };
}

function average(file, x, y, w, h) {
  const image = decodePng(file);
  const scaleX = image.width / (Number(process.env.QA_CSS_WIDTH) || image.width);
  void scaleX;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let row = y; row < Math.min(y + h, image.height); row += 1) {
    for (let column = x; column < Math.min(x + w, image.width); column += 1) {
      const i = (row * image.width + column) * image.channels;
      r += image.pixels[i];
      g += image.pixels[i + 1];
      b += image.pixels[i + 2];
      count += 1;
    }
  }
  if (!count) throw new Error(`${file}: empty region`);
  const avg = [r / count, g / count, b / count].map((value) => Math.round(value));
  const hex = `#${avg.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  const brightness = ((avg[0] * 0.299 + avg[1] * 0.587 + avg[2] * 0.114) / 255).toFixed(3);
  return { hex, avg, brightness: Number(brightness), size: `${image.width}x${image.height}` };
}

const [first, ...rest] = process.argv.slice(2);
if (first === "--diff") {
  const [a, b, x, y, w, h] = rest;
  const one = average(a, Number(x), Number(y), Number(w), Number(h));
  const two = average(b, Number(x), Number(y), Number(w), Number(h));
  console.log(`a: ${one.hex} brightness=${one.brightness} (${one.size})`);
  console.log(`b: ${two.hex} brightness=${two.brightness} (${two.size})`);
  console.log(`delta brightness: ${Math.abs(one.brightness - two.brightness).toFixed(3)}`);
} else {
  const [x, y, w, h] = rest;
  const one = average(first, Number(x), Number(y), Number(w), Number(h));
  console.log(`avg=${one.hex} brightness=${one.brightness} image=${one.size}`);
}
