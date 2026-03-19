// src/main/tts-service.js — PowerShell SpeechSynthesizer, killable at any time
const { spawn, spawnSync } = require('child_process');

let _proc     = null;
let _speaking = false;
let _resolve  = null;

function speak(text) {
  return new Promise((resolve) => {
    stop(); // always stop current speech before starting new one

    _speaking = true;
    _resolve  = resolve;

    const clean = text
      .replace(/[*_#`~>]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/'/g, ' ')   // avoid breaking PS string
      .replace(/"/g, ' ')
      .slice(0, 600)        // cap length so it doesn't run forever
      .trim();

    const ps =
      'Add-Type -AssemblyName System.Speech;' +
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
      '$s.Rate = 1; $s.Volume = 100;' +
      "$s.Speak('" + clean + "');" +
      '$s.Dispose();';

    _proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    _proc.stderr.on('data', d => {
      const m = d.toString().trim();
      if (m) console.warn('[TTS]', m.slice(0, 80));
    });

    _proc.on('close', () => {
      _speaking = false;
      _proc     = null;
      if (_resolve) { _resolve(); _resolve = null; }
    });

    _proc.on('error', err => {
      console.error('[TTS] spawn error:', err.message);
      _speaking = false;
      _proc     = null;
      if (_resolve) { _resolve(); _resolve = null; }
    });
  });
}

function stop() {
  if (_proc) {
    try {
      // Kill the PowerShell process tree so speech stops immediately
      spawnSync('taskkill', ['/PID', String(_proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
    _proc = null;
  }
  _speaking = false;
  if (_resolve) { _resolve(); _resolve = null; }
}

function isSpeaking() { return _speaking; }

module.exports = { speak, stop, isSpeaking };