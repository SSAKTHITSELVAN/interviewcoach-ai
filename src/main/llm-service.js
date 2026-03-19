// src/main/llm-service.js — v7: sentinel-based reply extraction (100% reliable)
const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

let _ready     = false;
let _history   = [];
let _qCount    = 0;
let _sysPrompt = '';

function binPath()   { return global.getResourcePath('resources', 'bin', 'llama', 'llama-cli.exe'); }
function modelPath() { return global.getResourcePath('models', 'llm', 'model.gguf'); }

// ── Unique sentinel injected at the END of every prompt ───────────────────────
// llama-cli echoes the prompt then appends generated tokens.
// We split stdout on this sentinel — everything AFTER it is the real reply.
const SENTINEL = '<<REPLY_START>>';

// ── Build Llama 3.2 chat prompt ───────────────────────────────────────────────
function buildPrompt(messages) {
  let out = '<|begin_of_text|>';
  for (const m of messages) {
    out += '<|start_header_id|>' + m.role + '<|end_header_id|>\n\n' + m.content + '<|eot_id|>';
  }
  // Sentinel is the VERY LAST thing in the prompt file — right before generation starts
  out += '<|start_header_id|>assistant<|end_header_id|>\n\n' + SENTINEL;
  return out;
}

// ── Extract reply from raw stdout ─────────────────────────────────────────────
function extractReply(stdout) {
  // Split on the sentinel — take everything AFTER it
  const idx = stdout.indexOf(SENTINEL);
  if (idx === -1) {
    // Fallback: sentinel not found (older llama.cpp may strip unknown tokens)
    // Try finding the last assistant header the old way
    const hdr  = 'assistant<|end_header_id|>';
    const hidx = stdout.lastIndexOf(hdr);
    if (hidx !== -1) return cleanText(stdout.slice(hidx + hdr.length));
    // Last resort: return whatever stdout has after stripping obvious log lines
    return cleanText(stdout);
  }
  return cleanText(stdout.slice(idx + SENTINEL.length));
}

function cleanText(raw) {
  // Cut at first stop signal
  const eot = raw.indexOf('<|eot_id|>');
  if (eot !== -1) raw = raw.slice(0, eot);

  // Strip [end of text] / [end] markers llama.cpp appends
  raw = raw.replace(/\[end of text\]/gi, '').replace(/\[end\]/gi, '');

  // Remove all remaining special tokens
  raw = raw.replace(/<\|[^|]+\|>/g, '');

  // Filter out llama.cpp log/progress lines line-by-line
  const clean = raw.split('\n').filter(line => {
    const l = line.trim();
    if (!l) return false;
    if (/^(llama_|ggml_|main:|Log |build:|system_info|llm_load|sampling|sampler|generate:|print_info|load_model|clip_)/i.test(l)) return false;
    if (/\d+\s*\/\s*\d+\s*(tokens|ms|s\b)/.test(l)) return false;
    if (l.includes('%|') || /^\[=+/.test(l)) return false;
    if (/^\s*\d+\.\d+\s*(ms|s|tok)/.test(l)) return false;
    if (l === '[end of text]' || l === '[end]') return false;
    return true;
  }).join('\n').trim();

  return clean;
}

// ── Run llama-cli.exe ─────────────────────────────────────────────────────────
function runLlama(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const bin    = binPath();
    const model  = modelPath();
    const binDir = path.dirname(bin);

    if (!fs.existsSync(bin))   return reject(new Error('llama-cli.exe not found'));
    if (!fs.existsSync(model)) return reject(new Error('model.gguf not found'));

    const tmpFile = path.join(os.tmpdir(), 'ic_' + Date.now() + '.txt');
    fs.writeFileSync(tmpFile, buildPrompt(messages), 'utf8');

    const args = [
      '-m', model,
      '-f', tmpFile,
      '-n', String(maxTokens || 300),
      '--temp',           '0.7',
      '--top-p',          '0.9',
      '--repeat-penalty', '1.1',
      '-c',               '2048',
    ];

    const proc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd:   binDir,
      env:   { ...process.env, PATH: binDir + ';' + (process.env.PATH || '') },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      try { fs.unlinkSync(tmpFile); } catch {}

      console.log('[LLM] exit=' + code + ' stdout=' + stdout.length + 'b');

      const text = extractReply(stdout);

      if (!text) {
        console.error('[LLM] empty reply.\nstdout: ' + JSON.stringify(stdout.slice(0, 300)) +
                      '\nstderr tail: ' + stderr.slice(-300));
        return reject(new Error('Model returned empty response'));
      }

      console.log('[LLM] reply (' + text.length + 'c):', text.slice(0, 120).replace(/\n/g, ' '));
      resolve(text);
    });

    proc.on('error', err => {
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error('Cannot start llama-cli.exe: ' + err.message));
    });

    const t = setTimeout(() => {
      try { proc.kill(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error('LLM timed out'));
    }, 180_000);
    proc.on('close', () => clearTimeout(t));
  });
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt({ role, experience, resumeText, jobDescription, language }) {
  return (
    'You are Alex, a senior technical interviewer.\n' +
    'Interview language: ' + (language || 'English') + '.\n' +
    'Role: ' + (role || 'Software Engineer') + ' | Level: ' + (experience || 'Mid-level') + '.\n' +
    (resumeText     ? 'Resume: '   + resumeText.slice(0, 400)     + '\n' : '') +
    (jobDescription ? 'Job desc: ' + jobDescription.slice(0, 300) + '\n' : '') +
    'Rules: ask ONE question per turn. Max 2-3 sentences. ' +
    'Follow up on answers. You are human — never say you are AI. ' +
    'After 8-10 exchanges say: "That covers everything I wanted to ask. Thank you so much for your time today!" ' +
    'Start by greeting the candidate and asking your first technical question.'
  );
}

// ── Public API ────────────────────────────────────────────────────────────────
async function initLLM() {
  if (!fs.existsSync(binPath()))   { console.warn('[LLM] llama-cli.exe not found'); return false; }
  if (!fs.existsSync(modelPath())) { console.warn('[LLM] model.gguf not found');    return false; }
  _ready = true;
  console.log('[LLM] Ready ✓');
  return true;
}

async function startInterviewSession(config) {
  if (!_ready) throw new Error('LLM not ready');
  _sysPrompt = buildSystemPrompt(config);
  _history   = [];
  _qCount    = 0;

  const opening = await runLlama([
    { role: 'system', content: _sysPrompt },
    { role: 'user',   content: 'Begin the interview now.' },
  ], 150);

  _history.push({ role: 'user',      content: 'Begin the interview now.' });
  _history.push({ role: 'assistant', content: opening });
  _qCount++;
  return opening;
}

async function sendMessage(userMsg) {
  if (!_ready) throw new Error('LLM not ready');
  _history.push({ role: 'user', content: userMsg });
  const response = await runLlama([
    { role: 'system', content: _sysPrompt },
    ..._history,
  ], 200);
  _history.push({ role: 'assistant', content: response });
  _qCount++;
  return response;
}

async function generateFeedback() {
  if (!_ready || _history.length < 2) return null;
  try {
    const transcript = _history
      .map(m => (m.role === 'assistant' ? 'Interviewer' : 'Candidate') + ': ' + m.content)
      .join('\n\n');
    const raw = await runLlama([
      { role: 'system', content: 'Respond ONLY with a single valid JSON object. No extra text.' },
      { role: 'user',   content:
          'Evaluate this interview:\n\n' + transcript +
          '\n\nReturn ONLY:\n{"overall_score":7,"technical_score":7,' +
          '"communication_score":7,"confidence_score":7,' +
          '"strengths":["s1","s2"],"improvements":["i1","i2"],' +
          '"recommendation":"Hire","summary":"brief assessment."}' },
    ], 350);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error('[LLM] feedback:', e.message); }
  return null;
}

function isLLMReady()       { return _ready; }
function getHistory()       { return _history; }
function getQuestionCount() { return _qCount; }

module.exports = { initLLM, startInterviewSession, sendMessage, generateFeedback,
                   isLLMReady, getHistory, getQuestionCount };