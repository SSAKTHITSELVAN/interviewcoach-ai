// scripts/download-models.js — v6 (CPU auto-detect + VC++ check)
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MODELS = [
  {
    name   : 'LLM model — Llama 3.2 1B Instruct Q4_K_M (~808 MB)',
    url    : 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    dest   : path.join(ROOT, 'models', 'llm', 'model.gguf'),
    minSize: 700_000_000,
  },
  {
    name   : 'Whisper STT model — ggml-tiny.en (~75 MB)',
    url    : 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    dest   : path.join(ROOT, 'resources', 'models', 'whisper', 'ggml-tiny.en.bin'),
    minSize: 70_000_000,
  },
];

// Whisper.cpp binary builds (same release cadence as llama.cpp)
const WHISPER_BUILDS = [
  { name: 'b1.7.4 win-x64', url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip' },
  { name: 'b1.7.3 win-x64', url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.3/whisper-bin-x64.zip' },
  { name: 'b1.7.2 win-x64', url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.2/whisper-bin-x64.zip' },
];

// Build tag → try latest stable builds, avx2 first then avx fallback
const LLAMA_BUILDS = [
  { tag: 'b4553', variant: 'avx2', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx2-x64.zip' },
  { tag: 'b4553', variant: 'avx',  url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4553/llama-b4553-bin-win-avx-x64.zip'  },
  { tag: 'b4400', variant: 'avx2', url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx2-x64.zip' },
  { tag: 'b4400', variant: 'avx',  url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4400/llama-b4400-bin-win-avx-x64.zip'  },
  { tag: 'b4200', variant: 'noavx',url: 'https://github.com/ggerganov/llama.cpp/releases/download/b4200/llama-b4200-bin-win-noavx-x64.zip' },
];

// ── helpers ───────────────────────────────────────────────────────────────────
function ensureDir(f) { fs.mkdirSync(path.dirname(f), { recursive: true }); }
function fileSize(p)  { try { return fs.statSync(p).size; } catch { return 0; } }
function fmtMB(b)     { return (b / 1_000_000).toFixed(1) + ' MB'; }
function bar(d, t, w = 35) {
  const p = t ? d / t : 0, f = Math.round(p * w);
  return '[' + '█'.repeat(f) + '░'.repeat(w - f) + '] ' +
    (p * 100).toFixed(1).padStart(5) + '%  ' + fmtMB(d) + ' / ' + fmtMB(t || d);
}

// ── detect CPU features ───────────────────────────────────────────────────────
function detectCPU() {
  try {
    const ps = `(Get-WmiObject Win32_Processor).Name`;
    const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    const name = (r.stdout || '').trim();

    // Check AVX2 support via CPUID
    const avx2ps = `
      Add-Type -TypeDefinition @'
      using System; using System.Runtime.Intrinsics.X86;
      public class CPU { public static bool HasAVX2() { return Avx2.IsSupported; } }
'@ -Language CSharp
      [CPU]::HasAVX2()
    `;
    const avx2r = spawnSync('powershell', ['-NoProfile', '-Command', avx2ps], { encoding: 'utf8' });
    const hasAVX2 = (avx2r.stdout || '').trim().toLowerCase() === 'true';

    return { name, hasAVX2 };
  } catch {
    return { name: 'Unknown', hasAVX2: false };
  }
}

// ── check VC++ redist ─────────────────────────────────────────────────────────
function checkVCRedist() {
  try {
    const ps = `Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\X64' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Version`;
    const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    const ver = (r.stdout || '').trim();
    return ver.length > 0;
  } catch {
    return false;
  }
}

// ── resumable download ────────────────────────────────────────────────────────
function download(url, dest, minSize) {
  return new Promise((resolve, reject) => {
    ensureDir(dest);
    const tmp = dest + '.tmp';
    if (minSize && fileSize(dest) >= minSize) {
      console.log('  ✓ Already complete: ' + path.basename(dest) + ' (' + fmtMB(fileSize(dest)) + ')');
      return resolve();
    }
    const startByte = fileSize(tmp);
    if (startByte > 0) console.log('  ↻ Resuming from ' + fmtMB(startByte) + '...');
    const stream  = fs.createWriteStream(tmp, { flags: startByte > 0 ? 'a' : 'w' });
    const headers = startByte > 0 ? { Range: 'bytes=' + startByte + '-' } : {};

    function attempt(u, retries) {
      (u.startsWith('https') ? https : http).get(u, { headers }, res => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location)
          return attempt(res.headers.location, retries);
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
          const got = fileSize(tmp);
          if (minSize && got < minSize) return reject(new Error('Incomplete: ' + fmtMB(got)));
          fs.renameSync(tmp, dest);
          console.log('  ✓ Saved: ' + path.basename(dest) + ' (' + fmtMB(got) + ')');
          resolve();
        }));
        res.on('error', err => retry(u, retries, err));
      }).on('error', err => retry(u, retries, err));
      function retry(u, r, e) {
        stream.close();
        if (r > 0) { console.warn('\n  ⚠ Retrying...'); setTimeout(() => attempt(u, r-1), 2000); }
        else reject(e);
      }
    }
    attempt(url, 3);
  });
}

function findFile(dir, names) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir)) {
    const fp = path.join(dir, e);
    if (fs.statSync(fp).isDirectory()) { const r = findFile(fp, names); if (r) return r; }
    else if (names.map(n=>n.toLowerCase()).includes(e.toLowerCase())) return fp;
  }
  return null;
}

// ── test if binary actually runs ──────────────────────────────────────────────
function testBinary(binPath) {
  try {
    const r = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 8000 });
    // exit 0 or 1 both indicate the binary loads; a crash gives null/signal
    return r.status !== null && r.signal === null;
  } catch {
    return false;
  }
}

// ── download + extract llama-cli.exe, test it works ───────────────────────────
async function downloadLlamaBin(preferAVX2) {
  const binDir  = path.join(ROOT, 'resources', 'bin');
  const binDest = path.join(binDir, 'llama-cli.exe');

  if (fs.existsSync(binDest) && fileSize(binDest) > 500_000) {
    if (testBinary(binDest)) {
      console.log('  ✓ llama-cli.exe already installed and working (' + fmtMB(fileSize(binDest)) + ')');
      return true;
    }
    console.log('  ⚠ Existing llama-cli.exe failed test — re-downloading...');
    fs.unlinkSync(binDest);
  }
  fs.mkdirSync(binDir, { recursive: true });

  // Sort builds: preferred variant first
  const builds = preferAVX2
    ? LLAMA_BUILDS
    : LLAMA_BUILDS.filter(b => b.variant !== 'avx2').concat(LLAMA_BUILDS.filter(b => b.variant === 'avx2'));

  for (const build of builds) {
    const zipDest = path.join(binDir, 'llama-bin.zip');
    console.log('  Trying llama.cpp ' + build.tag + ' (' + build.variant.toUpperCase() + ')...');
    try {
      try { fs.unlinkSync(zipDest); }          catch {}
      try { fs.unlinkSync(zipDest + '.tmp'); } catch {}

      await download(build.url, zipDest, 1_000_000);

      const unzipDir = path.join(binDir, '_unzip');
      if (fs.existsSync(unzipDir)) fs.rmSync(unzipDir, { recursive: true, force: true });
      fs.mkdirSync(unzipDir, { recursive: true });

      const ps = "Expand-Archive -Force '" + zipDest + "' '" + unzipDir + "'";
      const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('Extract failed');

      const exe = findFile(unzipDir, ['llama-cli.exe', 'main.exe']);
      if (!exe) throw new Error('Binary not found in zip');

      fs.copyFileSync(exe, binDest);

      // Also copy required DLLs from the same zip directory
      const exeDir = path.dirname(exe);
      let dllCount = 0;
      for (const f of fs.readdirSync(exeDir)) {
        if (f.toLowerCase().endsWith('.dll')) {
          fs.copyFileSync(path.join(exeDir, f), path.join(binDir, f));
          dllCount++;
        }
      }
      if (dllCount > 0) console.log('  ✓ Copied ' + dllCount + ' required DLLs');

      try { fs.rmSync(unzipDir,  { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(zipDest); } catch {}

      // Test it actually runs
      console.log('  Testing binary...');
      if (testBinary(binDest)) {
        console.log('  ✓ llama-cli.exe works! (' + fmtMB(fileSize(binDest)) + ')');
        return true;
      } else {
        console.warn('  ✗ Binary crashes on this CPU — trying next variant...');
        fs.unlinkSync(binDest);
        // Clean up DLLs too
        for (const f of fs.readdirSync(binDir)) {
          if (f.toLowerCase().endsWith('.dll')) try { fs.unlinkSync(path.join(binDir, f)); } catch {}
        }
      }
    } catch (e) {
      console.warn('  ✗ ' + e.message);
    }
  }

  console.log('\n  ── Manual install ─────────────────────────────────────────────');
  console.log('  1. Install VC++ first: https://aka.ms/vs/17/release/vc_redist.x64.exe');
  console.log('  2. Then: https://github.com/ggerganov/llama.cpp/releases');
  console.log('     Download: llama-bXXXX-bin-win-avx2-x64.zip (or avx-x64.zip for older CPUs)');
  console.log('  3. Copy llama-cli.exe AND all .dll files → resources/bin/');
  console.log('  ───────────────────────────────────────────────────────────────\n');
  return false;
}


// ── download + extract whisper.exe ───────────────────────────────────────────
async function downloadWhisperBin() {
  const binDir  = path.join(ROOT, 'resources', 'bin');
  const binDest = path.join(binDir, 'whisper.exe');

  if (fs.existsSync(binDest) && fileSize(binDest) > 500_000) {
    console.log('  ✓ whisper.exe already installed (' + fmtMB(fileSize(binDest)) + ')');
    return true;
  }
  fs.mkdirSync(binDir, { recursive: true });

  for (const build of WHISPER_BUILDS) {
    const zipDest  = path.join(binDir, 'whisper-bin.zip');
    const unzipDir = path.join(binDir, '_whisper_unzip');
    console.log('  Trying whisper.cpp ' + build.name + '...');
    try {
      try { fs.unlinkSync(zipDest); }          catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}

      await download(build.url, zipDest, 500_000);
      fs.mkdirSync(unzipDir, { recursive: true });

      const ps = "Expand-Archive -Force '" + zipDest + "' '" + unzipDir + "'";
      const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('Extract failed: ' + r.stderr);

      // Find whisper-cli.exe or main.exe inside zip
      const exe = findFile(unzipDir, ['whisper-cli.exe', 'whisper-main.exe', 'main.exe']);
      if (!exe) throw new Error('No whisper exe found in zip');

      fs.copyFileSync(exe, binDest);

      // Copy all DLLs alongside
      const exeDir = path.dirname(exe);
      let dllCount = 0;
      for (const f of fs.readdirSync(exeDir)) {
        if (f.toLowerCase().endsWith('.dll')) {
          fs.copyFileSync(path.join(exeDir, f), path.join(binDir, f));
          dllCount++;
        }
      }

      try { fs.rmSync(unzipDir,  { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(zipDest); } catch {}

      console.log('  ✓ whisper.exe installed (' + fmtMB(fileSize(binDest)) + ') + ' + dllCount + ' DLLs');
      return true;
    } catch (e) {
      console.warn('  ✗ ' + e.message);
      try { fs.unlinkSync(zipDest); }                                 catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}
    }
  }

  console.log('\n  ── Manual Whisper install ──────────────────────────────────');
  console.log('  1. Download: https://github.com/ggerganov/whisper.cpp/releases');
  console.log('     → whisper-bin-x64.zip');
  console.log('  2. Extract ALL files (exe + dlls) → resources/bin/');
  console.log('  3. Rename the exe to whisper.exe');
  console.log('  ────────────────────────────────────────────────────────────\n');
  return false;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   InterviewCouch — Model Setup            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // CPU detection
  console.log('🔍 Detecting your CPU...');
  const cpu = detectCPU();
  console.log('  CPU: ' + (cpu.name || 'Unknown'));
  console.log('  AVX2: ' + (cpu.hasAVX2 ? '✓ Supported' : '✗ Not supported — will use AVX build'));

  const vcOk = checkVCRedist();
  if (!vcOk) {
    console.log('\n  ⚠ Visual C++ Redistributable not detected!');
    console.log('  This is REQUIRED for llama-cli.exe to run.');
    console.log('  Please install it first:');
    console.log('  → https://aka.ms/vs/17/release/vc_redist.x64.exe\n');
  } else {
    console.log('  VC++ Redistributable: ✓\n');
  }

  // LLM model
  for (const m of MODELS) {
    console.log('📦 ' + m.name);
    try { await download(m.url, m.dest, m.minSize); }
    catch (e) { console.error('  ✗ ' + e.message); }
    console.log('');
  }

  // llama.cpp binary
  console.log('📦 llama.cpp Windows binary');
  await downloadLlamaBin(cpu.hasAVX2);

  // Whisper binary
  console.log('\n📦 Whisper.cpp STT binary');
  await downloadWhisperBin();

  // Verification
  console.log('\n── Verification ──────────────────────────────');
  const checks = [
    { label: 'LLM model       ', file: path.join(ROOT, 'models', 'llm', 'model.gguf'),                              min: 700_000_000 },
    { label: 'llama-cli.exe   ', file: path.join(ROOT, 'resources', 'bin', 'llama-cli.exe'),                        min:     500_000 },
    { label: 'whisper.exe     ', file: path.join(ROOT, 'resources', 'bin', 'whisper.exe'),                          min:     500_000 },
    { label: 'whisper model   ', file: path.join(ROOT, 'resources', 'models', 'whisper', 'ggml-tiny.en.bin'),       min:  70_000_000 },
  ];
  let allOk = true;
  for (const c of checks) {
    const sz = fileSize(c.file), ok = sz >= c.min;
    if (!ok) allOk = false;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.label + '  ' + (ok ? fmtMB(sz) : 'MISSING'));
  }
  // DLL check
  const binDir = path.join(ROOT, 'resources', 'bin');
  const dlls   = fs.existsSync(binDir) ? fs.readdirSync(binDir).filter(f => f.toLowerCase().endsWith('.dll')) : [];
  console.log('  ' + (dlls.length > 0 ? '✓' : '⚠') + ' DLL files        ' + (dlls.length > 0 ? dlls.length + ' files present' : 'NONE — may be needed'));
  console.log('  ✓ TTS   Windows SAPI (built-in)\n');

  if (allOk) console.log('✅ All ready!  Run: npm start\n');
  else        console.log('⚠  See instructions above, then run: npm start\n');
}

main().catch(console.error);