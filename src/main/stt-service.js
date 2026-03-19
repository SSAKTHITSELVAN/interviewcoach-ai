// src/main/stt-service.js — Whisper.cpp offline STT
// Receives 16kHz mono Float32 PCM from renderer, writes WAV, runs whisper.exe
const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

function whisperBin()   { return global.getResourcePath('resources', 'bin', 'whisper', 'whisper.exe'); }
function whisperModel() { return global.getResourcePath('resources', 'models', 'whisper', 'ggml-tiny.en.bin'); }

// ── Float32 PCM → 16-bit signed PCM WAV (16kHz mono) ─────────────────────────
function float32ToWav(float32Array, sampleRate) {
  const numSamples    = float32Array.length;
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign    = numChannels * bitsPerSample / 8;
  const dataSize      = numSamples * 2;          // 2 bytes per 16-bit sample
  const buf           = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);                        buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);                        buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);                   buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(numChannels, 22);          buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);             buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);        buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Convert Float32 [-1,1] → Int16 [-32768,32767]
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }

  return buf;
}

// ── Transcribe pre-resampled 16kHz mono float32 PCM ──────────────────────────
async function transcribeAudio(pcmData) {
  const bin   = whisperBin();
  const model = whisperModel();

  if (!fs.existsSync(bin))   throw new Error('whisper.exe not found — run npm run download');
  if (!fs.existsSync(model)) throw new Error('Whisper model not found — run npm run download');

  // pcmData arrives as a plain Array from IPC — convert back to Float32Array
  const float32 = Float32Array.from(pcmData);

  if (float32.length < 1600) {   // less than 0.1s at 16kHz — skip
    return '';
  }

  const tmpBase = path.join(os.tmpdir(), 'ic_stt_' + Date.now());
  const tmpWav  = tmpBase + '.wav';
  const tmpTxt  = tmpBase + '.txt';

  try {
    fs.writeFileSync(tmpWav, float32ToWav(float32, 16000));

    const binDir = path.dirname(bin);
    const text   = await new Promise((resolve, reject) => {
      const proc = spawn(bin, [
        '-m',  model,
        '-f',  tmpWav,
        '-l',  'en',
        '--output-txt',
        '--no-timestamps',
        '-of', tmpBase,
        '--print-special', 'false',
        '--threads', '4',
      ], {
        cwd:   binDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env:   { ...process.env, PATH: binDir + ';' + (process.env.PATH || '') },
      });

      let stdout = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', () => {});   // suppress progress logs

      const t = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('Whisper timed out')); }, 30_000);

      proc.on('close', () => {
        clearTimeout(t);
        try {
          let result = '';
          if (fs.existsSync(tmpTxt)) {
            result = fs.readFileSync(tmpTxt, 'utf8');
          } else {
            // fallback: parse stdout
            result = stdout.split('\n')
              .filter(l => l.trim() && !/^\[/.test(l.trim()))
              .join(' ');
          }
          // Strip noise/blank tags whisper emits
          result = result
            .replace(/\[BLANK_AUDIO\]/gi, '')
            .replace(/\(unintelligible\)/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
          resolve(result);
        } catch (e) { reject(new Error('Whisper read error: ' + e.message)); }
      });

      proc.on('error', err => { clearTimeout(t); reject(new Error('Cannot run whisper.exe: ' + err.message)); });
    });

    return text;
  } finally {
    try { fs.unlinkSync(tmpWav); } catch {}
    try { fs.unlinkSync(tmpTxt); } catch {}
  }
}

module.exports = { transcribeAudio };