// scripts/fix-whisper.js
// Downloads and installs whisper.exe for InterviewCouch
// Run: node scripts/fix-whisper.js

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawnSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'resources', 'bin');

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtMB(b) { return (b / 1e6).toFixed(1) + ' MB'; }
function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }

function bar(done, total) {
  const p = total ? done / total : 0;
  const f = Math.round(p * 35);
  return '[' + '█'.repeat(f) + '░'.repeat(35 - f) + '] ' +
    (p * 100).toFixed(1).padStart(5) + '%  ' + fmtMB(done) +
    (total ? ' / ' + fmtMB(total) : '');
}

// ── fetch JSON from GitHub API ────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    https.get({
      hostname: opts.hostname,
      path:     opts.pathname + opts.search,
      headers:  { 'User-Agent': 'interviewcouch-installer', 'Accept': 'application/vnd.github.v3+json' },
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// ── download with progress + redirect follow ──────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp    = dest + '.tmp';
    const stream = fs.createWriteStream(tmp);

    function get(u, redirects) {
      if (redirects > 8) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'interviewcouch-installer' } }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          stream.close();
          return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0, last = 0;
        res.on('data', chunk => {
          done += chunk.length;
          stream.write(chunk);
          if (Date.now() - last > 200) {
            process.stdout.write('\r  ' + bar(done, total));
            last = Date.now();
          }
        });
        res.on('end', () => stream.end(() => {
          process.stdout.write('\r  ' + bar(done, total) + '\n');
          fs.renameSync(tmp, dest);
          resolve(dest);
        }));
        res.on('error', err => { stream.close(); reject(err); });
      }).on('error', err => { stream.close(); reject(err); });
    }
    get(url, 0);
  });
}

// ── extract zip via PowerShell ────────────────────────────────────────────────
function extractZip(zipPath, outDir) {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ps = `Expand-Archive -Force '${zipPath}' '${outDir}'`;
  const r  = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Extract failed: ' + (r.stderr || r.stdout));
}

// ── walk dir recursively for files matching extensions ────────────────────────
function findFiles(dir, exts) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) found.push(...findFiles(full, exts));
    else if (exts.some(e => entry.toLowerCase().endsWith(e))) found.push(full);
  }
  return found;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   InterviewCouch — Whisper Setup          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const destExe = path.join(BIN_DIR, 'whisper.exe');

  // Already installed?
  if (fs.existsSync(destExe) && fileSize(destExe) > 500_000) {
    console.log('✓ whisper.exe already present (' + fmtMB(fileSize(destExe)) + ')');
    console.log('  Delete resources/bin/whisper.exe and re-run to force reinstall.\n');
    return;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  // ── Step 1: get latest release tag from GitHub API ────────────────────────
  let releaseAssets = [];
  let tagName = '';

  console.log('🔍 Fetching latest whisper.cpp release info…');
  try {
    const release = await fetchJson('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
    tagName = release.tag_name || '';
    releaseAssets = (release.assets || []).map(a => ({ name: a.name, url: a.browser_download_url }));
    console.log('  Latest release: ' + tagName);
    const winZips = releaseAssets.filter(a => a.name.includes('win') && a.name.endsWith('.zip'));
    console.log('  Windows assets: ' + winZips.map(a => a.name).join(', ') || 'none found');
  } catch (e) {
    console.warn('  ⚠ GitHub API unavailable (' + e.message + ') — using known URLs');
  }

  // ── Step 2: build candidate URL list ─────────────────────────────────────
  // Priority: API-provided assets first, then known-good hardcoded fallbacks
  const candidates = [];

  // From GitHub API response — prefer whisper-bin-x64.zip
  const apiWinZip = releaseAssets.find(a => a.name === 'whisper-bin-x64.zip');
  if (apiWinZip) candidates.push({ label: tagName + ' (API)', url: apiWinZip.url });

  // Also try whisper-blas-bin-x64.zip (OpenBLAS variant) from API
  const apiBlasZip = releaseAssets.find(a => a.name === 'whisper-blas-bin-x64.zip');
  if (apiBlasZip) candidates.push({ label: tagName + ' BLAS (API)', url: apiBlasZip.url });

  // Hardcoded known-good versions as fallbacks (ggml-org repo, correct zip name)
  const fallbackTags = ['v1.7.5', 'v1.7.4', 'v1.7.3', 'v1.7.2', 'v1.7.1', 'v1.6.2', 'v1.6.1'];
  for (const tag of fallbackTags) {
    if (tag === tagName) continue; // already added from API above
    candidates.push({
      label: tag,
      url:   `https://github.com/ggml-org/whisper.cpp/releases/download/${tag}/whisper-bin-x64.zip`,
    });
  }

  // ── Step 3: try each candidate ────────────────────────────────────────────
  const zipPath  = path.join(BIN_DIR, 'whisper-bin.zip');
  const unzipDir = path.join(BIN_DIR, '_whisper_unzip');

  for (const candidate of candidates) {
    console.log('\n📦 Trying ' + candidate.label + '…');
    console.log('   ' + candidate.url);

    // Clean up any previous attempt
    try { fs.unlinkSync(zipPath); }                                catch {}
    try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}

    try {
      await download(candidate.url, zipPath);

      const zipSize = fileSize(zipPath);
      if (zipSize < 500_000) throw new Error('Zip too small (' + fmtMB(zipSize) + ') — bad download');
      console.log('  Downloaded: ' + fmtMB(zipSize));

      // Extract
      console.log('  Extracting…');
      extractZip(zipPath, unzipDir);

      const exeFiles = findFiles(unzipDir, ['.exe']);
      const dllFiles = findFiles(unzipDir, ['.dll']);
      console.log('  Found: ' + exeFiles.length + ' exe, ' + dllFiles.length + ' DLLs');

      // Pick best exe: prefer whisper-cli.exe, then whisper.exe, then main.exe
      const exe =
        exeFiles.find(f => path.basename(f).toLowerCase() === 'whisper-cli.exe') ||
        exeFiles.find(f => path.basename(f).toLowerCase() === 'whisper.exe')     ||
        exeFiles.find(f => path.basename(f).toLowerCase() === 'main.exe')        ||
        exeFiles[0];

      if (!exe) throw new Error('No exe found inside zip');
      console.log('  Using exe: ' + path.basename(exe));

      // Copy exe → whisper.exe
      fs.copyFileSync(exe, destExe);

      // Copy all DLLs into bin dir (needed at runtime)
      let dllCount = 0;
      for (const dll of dllFiles) {
        const dest = path.join(BIN_DIR, path.basename(dll));
        fs.copyFileSync(dll, dest);
        dllCount++;
      }
      console.log('  Copied: whisper.exe + ' + dllCount + ' DLLs');

      // List everything in bin dir
      const binContents = fs.readdirSync(BIN_DIR)
        .filter(f => !f.startsWith('_') && !f.endsWith('.zip') && !f.endsWith('.tmp'));
      console.log('  bin/ contents: ' + binContents.join(', '));

      // Cleanup
      try { fs.rmSync(unzipDir,  { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(zipPath); }                                  catch {}

      // Verify
      const finalSize = fileSize(destExe);
      if (finalSize < 100_000) throw new Error('whisper.exe suspiciously small after copy');

      console.log('\n✅ whisper.exe installed! (' + fmtMB(finalSize) + ')');
      console.log('   Run: npm start\n');
      return;

    } catch (e) {
      console.warn('  ✗ ' + e.message);
      try { fs.unlinkSync(zipPath); }                                catch {}
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch {}
      // Also clean up any partial whisper.exe
      try { if (fileSize(destExe) < 500_000) fs.unlinkSync(destExe); } catch {}
    }
  }

  console.log('\n✗ All automatic attempts failed.');
  console.log('  Manual install:');
  console.log('  1. Go to: https://github.com/ggml-org/whisper.cpp/releases');
  console.log('  2. Download: whisper-bin-x64.zip');
  console.log('  3. Extract ALL files into: resources/bin/');
  console.log('  4. Rename whisper-cli.exe → whisper.exe (if needed)\n');
  process.exit(1);
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });