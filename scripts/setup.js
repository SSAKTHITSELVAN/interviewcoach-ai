// scripts/setup.js  — InterviewCouch full setup
// Downloads LLM model, llama-cli (with DLLs), whisper model, whisper-cli (with DLLs)
// Keeps llama and whisper in SEPARATE subfolders to avoid DLL conflicts
// Run: node scripts/setup.js

const https       = require('https');
const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const { spawnSync } = require('child_process');

const ROOT         = path.join(__dirname, '..');
const LLAMA_DIR    = path.join(ROOT, 'resources', 'bin', 'llama');    // llama-cli.exe + its DLLs
const WHISPER_DIR  = path.join(ROOT, 'resources', 'bin', 'whisper');  // whisper.exe  + its DLLs
const LLM_MODEL    = path.join(ROOT, 'models', 'llm', 'model.gguf');
const WHISPER_MODEL= path.join(ROOT, 'resources', 'models', 'whisper', 'ggml-tiny.en.bin');

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtMB(b)    { return (b / 1e6).toFixed(1) + ' MB'; }
function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function bar(done, total) {
  const p = total ? Math.min(done / total, 1) : 0;
  const f = Math.round(p * 35);
  return '[' + '█'.repeat(f) + '░'.repeat(35 - f) + '] ' +
    (p * 100).toFixed(1).padStart(5) + '%  ' + fmtMB(done) +
    (total ? ' / ' + fmtMB(total) : '');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'interviewcouch', 'Accept': 'application/vnd.github.v3+json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); } });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const tmp = dest + '.tmp';
    // Resume support
    const startByte = fileSize(tmp);
    const stream    = fs.createWriteStream(tmp, { flags: startByte > 0 ? 'a' : 'w' });
    if (startByte > 0) console.log('  ↻ Resuming from ' + fmtMB(startByte));

    function get(u, hops) {
      if (hops > 10) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      const hdrs = startByte > 0 ? { 'User-Agent': 'interviewcouch', 'Range': 'bytes=' + startByte + '-' }
                                 : { 'User-Agent': 'interviewcouch' };
      mod.get(u, { headers: hdrs }, res => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location)
          return get(res.headers.location, hops + 1);
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          stream.close(); return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) + startByte;
        let done = startByte, last = 0;
        res.on('data', chunk => {
          done += chunk.length; stream.write(chunk);
          if (Date.now() - last > 150) { process.stdout.write('\r  ' + bar(done, total)); last = Date.now(); }
        });
        res.on('end', () => stream.end(() => {
          process.stdout.write('\r  ' + bar(done, total) + '\n');
          fs.renameSync(tmp, dest);
          resolve();
        }));
        res.on('error', err => { stream.close(); reject(err); });
      }).on('error', err => { stream.close(); reject(err); });
    }
    get(url, 0);
  });
}

function extractZip(zipPath, outDir) {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Force '${zipPath}' '${outDir}'`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Extract failed: ' + (r.stderr || '').slice(0, 200));
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
    const r = spawnSync(bin, ['--version'], {
      encoding: 'utf8', timeout: 8000, cwd: path.dirname(bin),
      env: { ...process.env, PATH: path.dirname(bin) + ';' + (process.env.PATH || '') }
    });
    return r.status !== null && r.signal === null && r.status !== 3221226505;
  } catch { return false; }
}

// ── install binary from zip into its own folder ───────────────────────────────
async function installBinary({ label, candidates, destDir, exeNames, finalName }) {
  ensureDir(destDir);
  const destExe = path.join(destDir, finalName);

  if (fs.existsSync(destExe) && fileSize(destExe) > 400_000 && testBinary(destExe)) {
    console.log('  ✓ ' + finalName + ' already installed and working (' + fmtMB(fileSize(destExe)) + ')');
    return true;
  }
  if (fs.existsSync(destExe)) {
    console.log('  ⚠ Existing ' + finalName + ' failed test — reinstalling…');
    // Clean dir
    for (const f of fs.readdirSync(destDir)) {
      try { fs.unlinkSync(path.join(destDir, f)); } catch {}
    }
  }

  const zipPath  = path.join(destDir, '_download.zip');
  const unzipDir = path.join(destDir, '_unzip');

  for (const c of candidates) {
    console.log('\n  Trying: ' + c.label + '\n  ' + c.url);
    try {
      try { fs.unlinkSync(zipPath); }                                catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}

      await download(c.url, zipPath);
      const sz = fileSize(zipPath);
      if (sz < 1_000_000) throw new Error('Zip too small: ' + fmtMB(sz));

      console.log('  Extracting…');
      extractZip(zipPath, unzipDir);

      const exeFiles = findFiles(unzipDir, ['.exe']);
      const dllFiles = findFiles(unzipDir, ['.dll']);
      console.log('  Found ' + exeFiles.length + ' exe + ' + dllFiles.length + ' DLLs');

      // Pick exe by priority name list
      let exe = null;
      for (const name of exeNames) {
        exe = exeFiles.find(f => path.basename(f).toLowerCase() === name.toLowerCase());
        if (exe) break;
      }
      if (!exe) exe = exeFiles[0];
      if (!exe) throw new Error('No exe found in zip');
      console.log('  Using: ' + path.basename(exe));

      // Copy exe + ALL DLLs into destDir
      fs.copyFileSync(exe, destExe);
      let dllCount = 0;
      // Copy DLLs from the same directory as the exe
      const exeDir = path.dirname(exe);
      for (const f of fs.readdirSync(exeDir)) {
        if (f.toLowerCase().endsWith('.dll')) {
          fs.copyFileSync(path.join(exeDir, f), path.join(destDir, f));
          dllCount++;
        }
      }
      // Also copy any DLLs from other locations in the zip
      for (const dll of dllFiles) {
        const dllName = path.basename(dll);
        const dllDest = path.join(destDir, dllName);
        if (!fs.existsSync(dllDest)) {
          fs.copyFileSync(dll, dllDest);
          dllCount++;
        }
      }
      console.log('  Installed: ' + finalName + ' + ' + dllCount + ' DLLs');

      // Cleanup zip + unzip
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(zipPath); }                                catch {}

      // Test it works
      console.log('  Testing binary…');
      if (testBinary(destExe)) {
        console.log('  ✓ ' + finalName + ' works! (' + fmtMB(fileSize(destExe)) + ')');
        return true;
      } else {
        console.warn('  ✗ Binary test failed — trying next build…');
        for (const f of fs.readdirSync(destDir)) try { fs.unlinkSync(path.join(destDir, f)); } catch {}
      }
    } catch (e) {
      console.warn('  ✗ ' + e.message);
      try { fs.unlinkSync(zipPath); }                                catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}
    }
  }
  return false;
}

// ── get llama.cpp latest release from GitHub API ──────────────────────────────
async function getLlamaCandidates() {
  const candidates = [];
  try {
    const rel = await fetchJson('https://api.github.com/repos/ggerganov/llama.cpp/releases/latest');
    const tag = rel.tag_name || '';
    console.log('  llama.cpp latest: ' + tag);
    const assets = (rel.assets || []).map(a => ({ name: a.name, url: a.browser_download_url }));
    // AVX2 first, then AVX
    const avx2 = assets.find(a => a.name.includes('win') && a.name.includes('avx2') && a.name.endsWith('.zip'));
    const avx  = assets.find(a => a.name.includes('win') && a.name.includes('avx')  && !a.name.includes('avx2') && a.name.endsWith('.zip'));
    if (avx2) candidates.push({ label: tag + ' AVX2 (API)', url: avx2.url });
    if (avx)  candidates.push({ label: tag + ' AVX  (API)', url: avx.url  });
  } catch (e) { console.warn('  GitHub API unavailable: ' + e.message); }

  // Hardcoded fallbacks — your i3-1215U uses AVX (not AVX2 per download script)
  candidates.push({ label: 'b4553 AVX', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx-x64.zip' });
  candidates.push({ label: 'b4553 AVX2',url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx2-x64.zip' });
  candidates.push({ label: 'b4400 AVX', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx-x64.zip' });
  candidates.push({ label: 'b4400 AVX2',url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx2-x64.zip' });
  candidates.push({ label: 'b4200 noavx',url:'https://github.com/ggerganov/llama.cpp/releases/download/b4200/llama-b4200-bin-win-noavx-x64.zip' });
  return candidates;
}

// ── get whisper.cpp latest release from GitHub API ────────────────────────────
async function getWhisperCandidates() {
  const candidates = [];
  try {
    const rel = await fetchJson('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
    const tag = rel.tag_name || '';
    console.log('  whisper.cpp latest: ' + tag);
    const assets = (rel.assets || []).map(a => ({ name: a.name, url: a.browser_download_url }));
    const zip = assets.find(a => a.name === 'whisper-bin-x64.zip');
    if (zip) candidates.push({ label: tag + ' (API)', url: zip.url });
  } catch (e) { console.warn('  GitHub API unavailable: ' + e.message); }

  candidates.push({ label: 'v1.8.3', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip' });
  candidates.push({ label: 'v1.7.5', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.5/whisper-bin-x64.zip' });
  candidates.push({ label: 'v1.7.4', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip' });
  return candidates;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   InterviewCouch — Full Setup             ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── 1. LLM model ────────────────────────────────────────────────────────────
  console.log('━━━ 1/4  LLM Model (~808 MB) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (fileSize(LLM_MODEL) >= 700_000_000) {
    console.log('  ✓ model.gguf already present (' + fmtMB(fileSize(LLM_MODEL)) + ')\n');
  } else {
    ensureDir(path.dirname(LLM_MODEL));
    console.log('  Downloading Llama 3.2-1B Q4_K_M…');
    try {
      await download(
        'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        LLM_MODEL
      );
      console.log('  ✓ model.gguf (' + fmtMB(fileSize(LLM_MODEL)) + ')\n');
    } catch (e) { console.error('  ✗ ' + e.message + '\n'); }
  }

  // ── 2. Whisper model ────────────────────────────────────────────────────────
  console.log('━━━ 2/4  Whisper Model (~75 MB) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (fileSize(WHISPER_MODEL) >= 70_000_000) {
    console.log('  ✓ ggml-tiny.en.bin already present (' + fmtMB(fileSize(WHISPER_MODEL)) + ')\n');
  } else {
    ensureDir(path.dirname(WHISPER_MODEL));
    console.log('  Downloading Whisper tiny.en…');
    try {
      await download(
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
        WHISPER_MODEL
      );
      console.log('  ✓ ggml-tiny.en.bin (' + fmtMB(fileSize(WHISPER_MODEL)) + ')\n');
    } catch (e) { console.error('  ✗ ' + e.message + '\n'); }
  }

  // ── 3. llama-cli binary ─────────────────────────────────────────────────────
  console.log('━━━ 3/4  llama-cli binary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Checking GitHub for latest release…');
  const llamaCandidates = await getLlamaCandidates();
  const llamaOk = await installBinary({
    label:      'llama-cli',
    candidates: llamaCandidates,
    destDir:    LLAMA_DIR,
    exeNames:   ['llama-cli.exe', 'main.exe'],
    finalName:  'llama-cli.exe',
  });
  console.log('');

  // ── 4. whisper binary ───────────────────────────────────────────────────────
  console.log('━━━ 4/4  whisper binary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Checking GitHub for latest release…');
  const whisperCandidates = await getWhisperCandidates();
  const whisperOk = await installBinary({
    label:      'whisper',
    candidates: whisperCandidates,
    destDir:    WHISPER_DIR,
    exeNames:   ['whisper-cli.exe', 'whisper.exe', 'main.exe'],
    finalName:  'whisper.exe',
  });
  console.log('');

  // ── Verification ─────────────────────────────────────────────────────────────
  console.log('━━━ Verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const checks = [
    { label: 'LLM model       ', file: LLM_MODEL,                           min: 700_000_000 },
    { label: 'Whisper model   ', file: WHISPER_MODEL,                        min:  70_000_000 },
    { label: 'llama-cli.exe   ', file: path.join(LLAMA_DIR, 'llama-cli.exe'), min:     400_000 },
    { label: 'whisper.exe     ', file: path.join(WHISPER_DIR, 'whisper.exe'), min:     100_000 },
  ];
  let allOk = true;
  for (const c of checks) {
    const sz = fileSize(c.file), ok = sz >= c.min;
    if (!ok) allOk = false;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.label + (ok ? fmtMB(sz) : 'MISSING'));
  }
  console.log('  ✓ TTS             Windows SAPI (built-in)');
  console.log('');
  if (allOk) {
    console.log('✅  All ready! Run: npm start\n');
  } else {
    console.log('⚠   Some items missing — check errors above.\n');
    process.exit(1);
  }
}

main().catch(e => { console.error('\n✗ Fatal:', e.message); process.exit(1); });