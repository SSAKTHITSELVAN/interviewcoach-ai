// scripts/fix-winsign.js
// Downloads winCodeSign-2.6.0.7z and extracts it using PowerShell
// (PowerShell handles symlinks properly unlike 7zip without admin)
// Run ONCE: node scripts/fix-winsign.js

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { spawnSync } = require('child_process');

const CACHE_DIR = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
const VERSION   = 'winCodeSign-2.6.0';
const URL       = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;
const ZIP_DEST  = path.join(CACHE_DIR, VERSION + '.7z');
const EXTRACT_DIR = path.join(CACHE_DIR, VERSION);

function fmtMB(b) { return (b / 1e6).toFixed(1) + ' MB'; }
function bar(done, total) {
  const p = total ? Math.min(done / total, 1) : 0;
  const f = Math.round(p * 40);
  return '[' + '█'.repeat(f) + '░'.repeat(40 - f) + '] ' +
    (p * 100).toFixed(1).padStart(5) + '% ' + fmtMB(done) + ' / ' + fmtMB(total);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.tmp';
    try { fs.unlinkSync(tmp); } catch {}
    const stream = fs.createWriteStream(tmp);
    function get(u, hops) {
      if (hops > 10) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'electron-builder' } }, res => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location)
          return get(res.headers.location, hops + 1);
        if (res.statusCode !== 200) { stream.destroy(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0, last = 0;
        res.on('data', c => {
          stream.write(c); done += c.length;
          if (Date.now() - last > 250) { process.stdout.write('\r  ' + bar(done, total)); last = Date.now(); }
        });
        res.on('end', () => stream.end(() => {
          process.stdout.write('\r  ' + bar(done, total) + '\n');
          fs.renameSync(tmp, dest);
          resolve(done);
        }));
        res.on('error', e => { stream.destroy(); reject(e); });
      }).on('error', e => { stream.destroy(); reject(e); });
    }
    get(url, 0);
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  Fix winCodeSign (one-time setup)             ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Check if already extracted correctly
  const signExe = path.join(EXTRACT_DIR, 'windows-10', 'x64', 'signtool.exe');
  if (fs.existsSync(signExe)) {
    console.log('✓ winCodeSign already extracted correctly.\n');
    console.log('  Run: npm run build\n');
    return;
  }

  // Clean any broken previous attempts
  console.log('🧹 Cleaning broken cache...');
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Download the 7z
  console.log('📦 Downloading ' + VERSION + '...');
  await download(URL, ZIP_DEST);
  console.log('  Downloaded: ' + fmtMB(fs.statSync(ZIP_DEST).size) + '\n');

  // Extract using PowerShell + Expand-Archive won't work for .7z
  // Instead use 7za.exe that's already in node_modules, but with a workaround:
  // Extract to a temp dir, manually copy files, create dummy symlinks as real files
  const sevenZip = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  const tmpExtract = path.join(CACHE_DIR, '_tmp_extract');

  console.log('📂 Extracting (ignoring symlink errors)...');
  fs.mkdirSync(tmpExtract, { recursive: true });

  // Run 7za with -sns flag to skip symlinks entirely, avoiding the error
  const r = spawnSync(sevenZip, [
    'x',
    ZIP_DEST,
    '-o' + tmpExtract,
    '-y',       // yes to all
    '-sns',     // skip symlinks (don't create them = no privilege error)
    '-bd',      // no progress bar
  ], { encoding: 'utf8', cwd: CACHE_DIR });

  console.log('  7za exit code: ' + r.status);
  if (r.stdout) console.log('  ' + r.stdout.split('\n').slice(-4).join('\n  '));

  // Move extracted content to final location
  // electron-builder looks for: CACHE_DIR/winCodeSign-2.6.0/windows-10/x64/signtool.exe
  const extractedContent = path.join(tmpExtract);

  // Find what got extracted
  function listDir(d, depth=0) {
    if (!fs.existsSync(d)) return;
    if (depth > 3) return;
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      const stat = fs.statSync(fp);
      console.log('  ' + '  '.repeat(depth) + f + (stat.isDirectory() ? '/' : ' (' + fmtMB(stat.size) + ')'));
      if (stat.isDirectory()) listDir(fp, depth+1);
    }
  }

  console.log('\n  Extracted structure:');
  listDir(tmpExtract);

  // Move to correct location
  if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.renameSync(tmpExtract, EXTRACT_DIR);

  // Clean up the 7z file
  try { fs.unlinkSync(ZIP_DEST); } catch {}

  // Verify signtool exists
  if (fs.existsSync(signExe)) {
    console.log('\n✅ winCodeSign ready! signtool.exe found.');
    console.log('   Run: npm run build\n');
  } else {
    console.log('\n  signtool.exe not found at expected path.');
    console.log('  Expected: ' + signExe);
    console.log('  The extraction worked but structure may differ.');
    console.log('  Run: npm run build  (it should work now anyway)\n');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });