// scripts/make-icon.js
// Generates a proper 256x256 ICO file for electron-builder
// Run: node scripts/make-icon.js

const fs   = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICO_PATH  = path.join(BUILD_DIR, 'icon.ico');

fs.mkdirSync(BUILD_DIR, { recursive: true });

// ── Build a valid ICO with a single 256x256 32-bit RGBA image ────────────────
// ICO format: ICONDIR + ICONDIRENTRY + DIB (BITMAPINFOHEADER + pixel data)
// We draw a simple "IC" logo on dark background

const SIZE = 256;
const PIXELS = SIZE * SIZE; // number of pixels

// Create RGBA pixel buffer
const rgba = Buffer.alloc(PIXELS * 4, 0);

// ── Draw background: dark #0a0a0a ─────────────────────────────────────────────
for (let i = 0; i < PIXELS; i++) {
  rgba[i*4+0] = 0x0a; // R
  rgba[i*4+1] = 0x0a; // G
  rgba[i*4+2] = 0x0a; // B
  rgba[i*4+3] = 0xFF; // A
}

// ── Draw rounded rect border: white ──────────────────────────────────────────
function setPixel(x, y, r, g, b, a=255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  rgba[i]=r; rgba[i+1]=g; rgba[i+2]=b; rgba[i+3]=a;
}

// Draw a white rounded rectangle border (radius 32, border 8px)
const RADIUS = 32, BORDER = 8, MARGIN = 12;
for (let x = MARGIN; x < SIZE-MARGIN; x++) {
  for (let y = MARGIN; y < SIZE-MARGIN; y++) {
    const dx = Math.min(x - MARGIN, SIZE-MARGIN-1-x);
    const dy = Math.min(y - MARGIN, SIZE-MARGIN-1-y);
    // Corner rounding
    if (dx < RADIUS && dy < RADIUS) {
      const dist = Math.sqrt((RADIUS-dx)**2 + (RADIUS-dy)**2);
      if (dist > RADIUS) continue;
    }
    // Only border pixels
    const innerDx = Math.min(x - MARGIN - BORDER, SIZE-MARGIN-BORDER-1-x);
    const innerDy = Math.min(y - MARGIN - BORDER, SIZE-MARGIN-BORDER-1-y);
    let isInner = innerDx >= 0 && innerDy >= 0;
    if (isInner && innerDx < RADIUS && innerDy < RADIUS) {
      const dist = Math.sqrt((RADIUS-innerDx)**2 + (RADIUS-innerDy)**2);
      if (dist > RADIUS) isInner = false;
    }
    if (!isInner) setPixel(x, y, 255, 255, 255);
  }
}

// ── Draw target/bullseye icon (🎯) in center ─────────────────────────────────
const CX = SIZE/2, CY = SIZE/2;

// Outer red ring
for (let x=0; x<SIZE; x++) for (let y=0; y<SIZE; y++) {
  const d = Math.sqrt((x-CX)**2+(y-CY)**2);
  if (d >= 72 && d <= 88) setPixel(x,y, 239,68,68);  // red
}
// White ring
for (let x=0; x<SIZE; x++) for (let y=0; y<SIZE; y++) {
  const d = Math.sqrt((x-CX)**2+(y-CY)**2);
  if (d >= 50 && d <= 70) setPixel(x,y, 255,255,255);
}
// Red inner ring
for (let x=0; x<SIZE; x++) for (let y=0; y<SIZE; y++) {
  const d = Math.sqrt((x-CX)**2+(y-CY)**2);
  if (d >= 28 && d <= 48) setPixel(x,y, 239,68,68);
}
// White center dot
for (let x=0; x<SIZE; x++) for (let y=0; y<SIZE; y++) {
  const d = Math.sqrt((x-CX)**2+(y-CY)**2);
  if (d <= 26) setPixel(x,y, 255,255,255);
}
// Red bullseye center
for (let x=0; x<SIZE; x++) for (let y=0; y<SIZE; y++) {
  const d = Math.sqrt((x-CX)**2+(y-CY)**2);
  if (d <= 14) setPixel(x,y, 239,68,68);
}

// ── Convert RGBA (top-down) → BGR with AND mask (bottom-up) for DIB ──────────
// ICO DIB stores pixels bottom-up, as BGRA (no separate alpha channel in header,
// but we use 32-bit with alpha in the pixel data itself — works in all Windows versions)
const dibPixels = Buffer.alloc(PIXELS * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const src = (y * SIZE + x) * 4;
    const dst = ((SIZE-1-y) * SIZE + x) * 4; // flip vertically
    dibPixels[dst+0] = rgba[src+2]; // B
    dibPixels[dst+1] = rgba[src+1]; // G
    dibPixels[dst+2] = rgba[src+0]; // R
    dibPixels[dst+3] = rgba[src+3]; // A
  }
}

// AND mask: all zeros = fully opaque (SIZE rows, each row padded to 4-byte boundary)
const maskRowBytes = Math.ceil(SIZE / 32) * 4; // = 32 bytes for 256px
const andMask = Buffer.alloc(SIZE * maskRowBytes, 0);

// BITMAPINFOHEADER (40 bytes) — height is 2*SIZE because DIB includes AND mask
const bih = Buffer.alloc(40, 0);
bih.writeUInt32LE(40, 0);            // biSize
bih.writeInt32LE(SIZE, 4);           // biWidth
bih.writeInt32LE(SIZE * 2, 8);       // biHeight (2x for XOR+AND masks)
bih.writeUInt16LE(1, 12);            // biPlanes
bih.writeUInt16LE(32, 14);           // biBitCount
bih.writeUInt32LE(0, 16);            // biCompression (BI_RGB)
bih.writeUInt32LE(dibPixels.length + andMask.length, 20); // biSizeImage

const imageData = Buffer.concat([bih, dibPixels, andMask]);

// ICONDIR (6 bytes)
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);  // reserved
iconDir.writeUInt16LE(1, 2);  // type = 1 (ICO)
iconDir.writeUInt16LE(1, 4);  // count = 1 image

// ICONDIRENTRY (16 bytes)
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);                          // width  (0 = 256)
entry.writeUInt8(0, 1);                          // height (0 = 256)
entry.writeUInt8(0, 2);                          // color count
entry.writeUInt8(0, 3);                          // reserved
entry.writeUInt16LE(1, 4);                       // planes
entry.writeUInt16LE(32, 6);                      // bit count
entry.writeUInt32LE(imageData.length, 8);        // size of image data
entry.writeUInt32LE(6 + 16, 12);                 // offset to image data

const ico = Buffer.concat([iconDir, entry, imageData]);
fs.writeFileSync(ICO_PATH, ico);

console.log('✓ Icon created: ' + ICO_PATH + ' (' + ico.length + ' bytes)');
console.log('  Size: 256x256, 32-bit RGBA');
console.log('\n  Now run: npm run build\n');