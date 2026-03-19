// scripts/fix-llama-bin.js
// Force re-downloads the correct llama.cpp zip and extracts ALL files (exe + DLLs)
// Run: node scripts/fix-llama-bin.js

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawnSync } = require('child_process');

const ROOT   = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'resources', 'bin');

// i3-1215U actually supports AVX2 — use avx2 build
// We try avx2 first, then avx as fallback
const BUILDS = [
  { name: 'b4553 AVX2', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx2-x64.zip' },
  { name: 'b4400 AVX2', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx2-x64.zip' },
  { name: 'b4553 AVX',  url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx-x64.zip'  },
  { name: 'b4400 AVX',  url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx-x64.zip'  },
];

function fmtMB(b)  { return (b / 1e6).toFixed(1) + ' MB'; }
function bar(d, t) {
  const p = t ? d / t : 0, f = Math.round(p * 35);
  return '[' + '█'.repeat(f) + '░'.repeat(35 - f) + '] ' + (p * 100).toFixed(1) + '%  ' + fmtMB(d) + ' / ' + fmtMB(t);
}

function downloadZip(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp    = dest + '.tmp';
    const stream = fs.createWriteStream(tmp);

    function get(u) {
      (u.startsWith('https') ? https : http).get(u, res => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location)
          return get(res.headers.location);
        if (res.statusCode !== 200) {
          stream.close();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0, last = 0;
        res.on('data', chunk => {
          done += chunk.length; stream.write(chunk);
          if (Date.now() - last > 200) { process.stdout.write('\r  ' + bar(done, total)); last = Date.now(); }
        });
        res.on('end', () => stream.end(() => {
          process.stdout.write('\r  ' + bar(done, total) + '\n');
          fs.renameSync(tmp, dest);
          resolve(dest);
        }));
        res.on('error', err => { stream.close(); reject(err); });
      }).on('error', err => { stream.close(); reject(err); });
    }
    get(url);
  });
}

function extractAll(zipPath, outDir) {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ps = "Expand-Archive -Force '" + zipPath + "' '" + outDir + "'";
  const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('PowerShell extract failed: ' + r.stderr);
}

function findFiles(dir, exts) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const e of fs.readdirSync(dir)) {
    const fp = path.join(dir, e);
    if (fs.statSync(fp).isDirectory()) found.push(...findFiles(fp, exts));
    else if (exts.some(x => e.toLowerCase().endsWith(x))) found.push(fp);
  }
  return found;
}

function testBinary(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, cwd: path.dirname(bin) });
    return r.status !== null && r.signal === null;
  } catch { return false; }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Fix: llama.cpp binary + DLLs            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Clean existing broken install
  console.log('Cleaning resources/bin/...');
  if (fs.existsSync(BIN_DIR)) {
    for (const f of fs.readdirSync(BIN_DIR)) {
      if (f.toLowerCase().endsWith('.exe') || f.toLowerCase().endsWith('.dll')) {
        try { fs.unlinkSync(path.join(BIN_DIR, f)); } catch {}
      }
    }
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });

  for (const build of BUILDS) {
    const zipPath  = path.join(BIN_DIR, 'llama.zip');
    const unzipDir = path.join(BIN_DIR, '_unzip');

    console.log('\nTrying: ' + build.name);
    try {
      // Download
      await downloadZip(build.url, zipPath);
      const zipMB = fs.statSync(zipPath).size / 1e6;
      console.log('  Downloaded: ' + fmtMB(fs.statSync(zipPath).size));

      if (zipMB < 1) throw new Error('Zip too small (' + fmtMB(fs.statSync(zipPath).size) + ') — bad download');

      // Extract everything
      console.log('  Extracting...');
      extractAll(zipPath, unzipDir);

      // Find all exe + dll files
      const exeFiles = findFiles(unzipDir, ['.exe']);
      const dllFiles = findFiles(unzipDir, ['.dll']);
      console.log('  Found: ' + exeFiles.length + ' exe, ' + dllFiles.length + ' DLLs');

      // Pick the right exe (llama-cli > main)
      const cli  = exeFiles.find(f => path.basename(f).toLowerCase() === 'llama-cli.exe');
      const main = exeFiles.find(f => path.basename(f).toLowerCase() === 'main.exe');
      const exe  = cli || main;
      if (!exe) throw new Error('No llama-cli.exe or main.exe in zip');

      // Copy exe + all DLLs to BIN_DIR
      const destExe = path.join(BIN_DIR, 'llama-cli.exe');
      fs.copyFileSync(exe, destExe);

      let dllCopied = 0;
      for (const dll of dllFiles) {
        const dest = path.join(BIN_DIR, path.basename(dll));
        fs.copyFileSync(dll, dest);
        dllCopied++;
      }
      console.log('  Copied: llama-cli.exe + ' + dllCopied + ' DLLs');

      // List what we copied
      const allFiles = fs.readdirSync(BIN_DIR).filter(f => !f.startsWith('_') && !f.endsWith('.zip'));
      console.log('  Files in bin/: ' + allFiles.join(', '));

      // Cleanup
      fs.rmSync(unzipDir, { recursive: true, force: true });
      fs.unlinkSync(zipPath);

      // Test
      console.log('  Testing binary (with DLLs)...');
      if (testBinary(destExe)) {
        console.log('\n✅ llama-cli.exe works with ' + dllCopied + ' DLLs!');
        console.log('   Run: npm start\n');
        return;
      } else {
        console.warn('  ✗ Still crashes — trying next build...');
        for (const f of fs.readdirSync(BIN_DIR)) {
          if (f.toLowerCase().endsWith('.exe') || f.toLowerCase().endsWith('.dll'))
            try { fs.unlinkSync(path.join(BIN_DIR, f)); } catch {}
        }
      }
    } catch (e) {
      console.warn('  ✗ ' + e.message);
      try { fs.unlinkSync(zipPath); }             catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}
    }
  }

  console.log('\n✗ All builds failed. Try manually:');
  console.log('  1. Install: https://aka.ms/vs/17/release/vc_redist.x64.exe');
  console.log('  2. Download: https://github.com/ggerganov/llama.cpp/releases');
  console.log('     → llama-bXXXX-bin-win-avx2-x64.zip');
  console.log('  3. Extract ALL files (exe + dlls) → resources/bin/\n');
}

main().catch(console.error);