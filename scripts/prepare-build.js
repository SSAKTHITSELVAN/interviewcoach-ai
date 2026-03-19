// scripts/prepare-build.js
// Run before building: checks everything is ready for electron-builder
// node scripts/prepare-build.js

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let allOk  = true;

function check(label, file, minSize = 0) {
  const exists = fs.existsSync(file);
  const size   = exists ? fs.statSync(file).size : 0;
  const ok     = exists && size >= minSize;
  console.log((ok ? '  ✓' : '  ✗') + ' ' + label);
  if (!ok) allOk = false;
  return ok;
}

console.log('\n── Pre-build checklist ─────────────────────────────────────────\n');

// Required models & binaries (must be present before building)
check('models/llm/model.gguf',                           path.join(ROOT, 'models/llm/model.gguf'),                                    700_000_000);
check('resources/models/whisper/ggml-tiny.en.bin',       path.join(ROOT, 'resources/models/whisper/ggml-tiny.en.bin'),                  70_000_000);
check('resources/bin/llama/llama-cli.exe',               path.join(ROOT, 'resources/bin/llama/llama-cli.exe'),                            400_000);
check('resources/bin/whisper/whisper.exe',               path.join(ROOT, 'resources/bin/whisper/whisper.exe'),                            100_000);

// Build icon — create a default one if missing
const iconDir  = path.join(ROOT, 'build');
const iconFile = path.join(iconDir, 'icon.ico');
if (!fs.existsSync(iconFile)) {
  console.log('  ⚠ build/icon.ico missing — creating placeholder');
  fs.mkdirSync(iconDir, { recursive: true });
  // Copy from assets/icon.ico if it exists, otherwise create a minimal valid ICO
  const assetIco = path.join(ROOT, 'assets', 'icon.ico');
  if (fs.existsSync(assetIco)) {
    fs.copyFileSync(assetIco, iconFile);
    console.log('  ✓ Copied from assets/icon.ico');
  } else {
    // Write a minimal valid 16x16 ICO file so electron-builder doesn't fail
    // (1x1 pixel transparent ICO — 40 bytes)
    const minIco = Buffer.from(
      '000001000100101000000100200068040000160000002800000010000000' +
      '200000000100200000000000400100000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000',
      'hex'
    );
    fs.writeFileSync(iconFile, minIco);
    console.log('  ✓ Placeholder icon created (replace build/icon.ico with your real icon)');
  }
} else {
  console.log('  ✓ build/icon.ico');
}

console.log('');
if (allOk) {
  console.log('✅  Ready to build! Run:\n');
  console.log('    npm run build          → installer (.exe setup wizard)');
  console.log('    npm run build:portable → portable  (single .exe, no install)\n');
  console.log('Output will be in: dist/\n');
} else {
  console.log('⚠   Some files missing. Run  npm run setup  first.\n');
  process.exit(1);
}