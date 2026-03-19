// scripts/build.js
// Downloads Electron, places it in the right cache, then runs electron-builder
// Run: node scripts/build.js
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { spawnSync, execSync } = require('child_process');

const VERSION  = '29.4.6';
const FILENAME = `electron-v${VERSION}-win32-x64.zip`;
const URL      = `https://github.com/electron/electron/releases/download/v${VERSION}/${FILENAME}`;

// This is where @electron/get (used by electron-builder 24+) caches files
// Format: <cache_root>/<filename> with env ELECTRON_GET_TEMP_CACHE_DIR
// The simplest reliable approach: put zip in a local ./cache folder
// and set ELECTRON_CACHE env var pointing there
const LOCAL_CACHE = path.join(__dirname, '..', '.electron-cache');
const DEST        = path.join(LOCAL_CACHE, FILENAME);

function fmtMB(b) { return (b / 1e6).toFixed(1) + ' MB'; }
function bar(done, total) {
  const p = total ? Math.min(done / total, 1) : 0;
  const f = Math.round(p * 40);
  return '[' + '█'.repeat(f) + '░'.repeat(40 - f) + '] ' +
    (p * 100).toFixed(1).padStart(5) + '% ' + fmtMB(done) + ' / ' + fmtMB(total);
}
function isValidZip(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const b  = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
  } catch { return false; }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
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
          if (!isValidZip(tmp)) { fs.unlinkSync(tmp); return reject(new Error('Not a valid ZIP')); }
          if (done < 100_000_000) { fs.unlinkSync(tmp); return reject(new Error('Too small: ' + fmtMB(done))); }
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
  console.log('║   InterviewCouch — Build                      ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ── Step 1: ensure Electron zip is cached locally ──────────────────────────
  fs.mkdirSync(LOCAL_CACHE, { recursive: true });

  if (fs.existsSync(DEST) && isValidZip(DEST) && fs.statSync(DEST).size > 100_000_000) {
    console.log('✓ Electron already cached (' + fmtMB(fs.statSync(DEST).size) + ')\n');
  } else {
    try { fs.unlinkSync(DEST); } catch {}
    console.log('📦 Downloading Electron v' + VERSION + '...');
    for (let i = 1; i <= 5; i++) {
      try {
        console.log('  Attempt ' + i + '/5');
        await download(URL, DEST);
        console.log('✓ Electron downloaded (' + fmtMB(fs.statSync(DEST).size) + ')\n');
        break;
      } catch(e) {
        console.warn('  ✗ ' + e.message);
        try { fs.unlinkSync(DEST); } catch {}
        if (i === 5) {
          console.error('\nAll download attempts failed.');
          console.error('Download manually from browser:\n  ' + URL);
          console.error('Place at: ' + DEST);
          process.exit(1);
        }
        await new Promise(r => setTimeout(r, i * 2000));
      }
    }
  }

  // ── Step 1b: fix winCodeSign (extract with symlink skip) ──────────────────────
  const winCodeSignDir = path.join(
    os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0'
  );
  const signtoolExe = path.join(winCodeSignDir, 'windows-10', 'x64', 'signtool.exe');
  if (!fs.existsSync(signtoolExe)) {
    console.log('🔧 Setting up winCodeSign (one-time)...');
    const fixResult = spawnSync('node', [path.join(__dirname, 'fix-winsign.js')], {
      cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: true
    });
    if (fixResult.status !== 0) {
      console.error('winCodeSign setup failed — try running as Administrator once');
      process.exit(1);
    }
  } else {
    console.log('✓ winCodeSign ready\n');
  }

  // ── Step 2: ensure 256x256 icon exists ────────────────────────────────────
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size < 10_000) {
    console.log('🎨 Generating app icon...');
    const iconResult = spawnSync('node', [path.join(__dirname, 'make-icon.js')], {
      cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: true
    });
    if (iconResult.status !== 0) { console.error('Icon generation failed'); process.exit(1); }
  } else {
    console.log('✓ Icon ready\n');
  }

  // ── Step 2: run electron-builder with ELECTRON_CACHE pointing to our folder ─
  console.log('🔨 Building installer...\n');

  const result = spawnSync(
    'npx', ['electron-builder', '--win', '--x64'],
    {
      cwd:   path.join(__dirname, '..'),
      stdio: 'inherit',
      env:   {
        ...process.env,
        // Tell @electron/get where our cached zip is
        ELECTRON_CACHE:               LOCAL_CACHE,
        electron_config_cache:        LOCAL_CACHE,
        // Disable code signing (no certificate needed for personal sharing)
        CSC_IDENTITY_AUTO_DISCOVERY:  'false',
      },
      shell: true,
    }
  );

  if (result.status !== 0) {
    console.error('\n✗ Build failed (exit ' + result.status + ')');
    process.exit(result.status);
  }

  console.log('\n✅ Build complete! Check dist/ folder for your installer.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });