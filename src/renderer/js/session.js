// src/renderer/js/session.js — v6
// MediaRecorder captures audio → AudioContext decodes + resamples to 16kHz mono
// → Float32 PCM sent to Whisper.cpp via IPC (fully offline, no network)
const MAX_Q = 10;

let config        = null;
let qCount        = 0;
let sessionEnded  = false;
let isListening   = false;
let isProcessing  = false;
let timerInterval = null;
let micStream     = null;
let mediaRecorder = null;
let audioChunks   = [];

// ── DOM ───────────────────────────────────────────────────────────────────────
const feed      = document.getElementById('feed');
const micBtn    = document.getElementById('micBtn');
const micLabel  = document.getElementById('micLabel');
const statusDot = document.getElementById('statusDot');
const statusTxt = document.getElementById('statusText');
const aiFace    = document.getElementById('aiFace');
const waveform  = document.getElementById('waveform');
const progFill  = document.getElementById('progFill');
const progLabel = document.getElementById('progLabel');
const roleChip  = document.getElementById('roleChip');
const liveDot   = document.getElementById('liveDot');
const timerEl   = document.getElementById('sessionTimer');
const toastRoot = document.getElementById('toast-root');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  config = await window.api.store.get('currentConfig');
  if (!config) { await window.api.navigate('setup'); return; }

  roleChip.textContent = config.role + ' · ' + config.experience;
  startTimer();
  injectTextInput();
  await setupMic();
  setStatus('thinking', 'Starting session…');

  try {
    const res = await window.api.llm.startSession(config);
    if (!res.ok) throw new Error(res.error || 'LLM start failed');
    appendAIMessage(res.message);
    await speakAI(res.message);
    qCount = 1;
    updateProgress();
    setReadyToListen();
  } catch (err) {
    toast('Start error: ' + err.message);
    setStatus('idle', 'Error');
  }
}

// ── Text input ────────────────────────────────────────────────────────────────
function injectTextInput() {
  const liveBar = document.getElementById('liveBar');
  if (!liveBar) return;
  liveBar.innerHTML =
    '<div style="display:flex;gap:8px;width:100%;align-items:center;padding:4px 0">' +
      '<input id="txtInput" type="text" autocomplete="off" ' +
        'placeholder="Type your answer or use the 🎙️ mic…" ' +
        'style="flex:1;background:var(--s2);border:1px solid var(--border);' +
               'border-radius:var(--r-md);color:var(--t1);font-family:var(--font);' +
               'font-size:14px;padding:9px 14px;outline:none;transition:border-color .15s">' +
      '<button id="sendBtn" onclick="sendTyped()" ' +
        'style="padding:9px 18px;background:var(--t1);color:var(--bg);' +
               'border:none;border-radius:var(--r-md);font-size:13px;' +
               'font-weight:600;cursor:pointer;white-space:nowrap;transition:background .25s">Send →</button>' +
    '</div>';

  const inp = document.getElementById('txtInput');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });
  inp.addEventListener('focus',   () => { inp.style.borderColor = 'var(--t2)'; });
  inp.addEventListener('blur',    () => { inp.style.borderColor = 'var(--border)'; });
}

function sendTyped() {
  if (isProcessing || sessionEnded) return;
  const inp = document.getElementById('txtInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  if (isListening) stopListening();
  window.api.tts.stop();
  processAnswer(text);
}

// ── Mic setup ─────────────────────────────────────────────────────────────────
async function setupMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    micBtn.disabled      = false;
    micLabel.textContent = 'Press 🎙️ or type below';
    console.log('[MIC] stream ready');
  } catch (err) {
    console.warn('[MIC] unavailable:', err.message);
    micBtn.disabled      = true;
    micLabel.textContent = 'Mic unavailable — type below';
    toast('Microphone not available. You can still type your answers.', 5000);
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────
function startListening() {
  if (isListening || isProcessing || sessionEnded || !micStream) return;
  window.api.tts.stop();
  audioChunks = [];

  const mimeType =
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
    MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm' :
    '';

  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(micStream, { mimeType })
      : new MediaRecorder(micStream);
  } catch (e) {
    toast('Cannot start recording: ' + e.message);
    return;
  }

  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop          = onRecordingStop;
  mediaRecorder.onerror         = e => {
    isListening = false;
    resetMicUI();
    toast('Recording error — type below.');
    setReadyToListen();
  };

  mediaRecorder.start(100);
  isListening = true;

  micBtn.textContent = '⏹️';
  micBtn.classList.add('recording');
  liveDot.style.display = 'block';
  setStatus('listening', 'Listening…');
  micLabel.textContent = 'Recording… click again to stop';

  const inp = document.getElementById('txtInput');
  if (inp) { inp.value = ''; inp.placeholder = 'Listening… speak now'; }
}

function stopListening() {
  if (!isListening || !mediaRecorder || mediaRecorder.state === 'inactive') return;
  try { mediaRecorder.stop(); } catch (e) { console.warn('[MIC]', e.message); }
}

async function toggleMic() {
  if (sessionEnded) return;
  if (isListening) stopListening();
  else startListening();
}

function resetMicUI() {
  micBtn.textContent = '🎙️';
  micBtn.classList.remove('recording');
  liveDot.style.display = 'none';
  isListening = false;
}

// ── Convert WebM blob → 16kHz mono Float32 PCM using AudioContext ─────────────
async function blobToFloat32PCM(blob) {
  const arrayBuf = await blob.arrayBuffer();

  // Decode compressed audio (webm/opus) to raw PCM
  const audioCtx  = new AudioContext({ sampleRate: 16000 });
  let   decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuf);
  } finally {
    audioCtx.close();
  }

  // Mix down to mono: average all channels
  const mono = new Float32Array(decoded.length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const chanData = decoded.getChannelData(ch);
    for (let i = 0; i < decoded.length; i++) mono[i] += chanData[i];
  }
  if (decoded.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= decoded.numberOfChannels;
  }

  // AudioContext already resampled to 16000 (specified above)
  return mono;
}

// ── Called when MediaRecorder finishes ────────────────────────────────────────
async function onRecordingStop() {
  resetMicUI();

  if (audioChunks.length === 0 || sessionEnded || isProcessing) {
    setReadyToListen();
    return;
  }

  const inp = document.getElementById('txtInput');
  setStatus('thinking', 'Transcribing…');
  micLabel.textContent  = 'Processing speech…';
  micBtn.disabled       = true;
  if (inp) inp.placeholder = 'Transcribing your speech…';

  try {
    const blob    = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    audioChunks   = [];

    // Decode + resample to 16kHz mono Float32
    const float32 = await blobToFloat32PCM(blob);

    // Minimum duration check: 0.3s at 16kHz = 4800 samples
    if (float32.length < 4800) {
      toast('Recording too short — hold the button while speaking.');
      setReadyToListen();
      if (inp) inp.placeholder = 'Type your answer or use the 🎙️ mic…';
      return;
    }

    // Send Float32 PCM to main process → whisper.exe
    const result = await window.api.stt.transcribe(float32);

    if (!result.ok) {
      throw new Error(result.error || 'Transcription failed');
    }

    const spoken = (result.text || '').trim();

    if (!spoken) {
      toast('No speech detected — try speaking clearly, or type below.');
      setReadyToListen();
      if (inp) inp.placeholder = 'Type your answer or use the 🎙️ mic…';
      return;
    }

    // Show transcript in input box for review/edit
    if (inp) {
      inp.value = spoken;
      inp.focus();
      inp.select();
      inp.placeholder = 'Edit if needed, then press Enter or Send →';
    }

    // Flash Send button green
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.style.background = 'var(--green)';
      setTimeout(() => { sendBtn.style.background = 'var(--t1)'; }, 900);
    }

    setReadyToListen();

  } catch (err) {
    console.error('[STT]', err);
    toast('Speech recognition failed: ' + err.message + '. Type below.');
    setReadyToListen();
    if (inp) inp.placeholder = 'Type your answer or use the 🎙️ mic…';
    audioChunks = [];
  }
}

// ── Process answer ─────────────────────────────────────────────────────────────
async function processAnswer(text) {
  text = text.trim();
  if (!text || isProcessing || sessionEnded) return;

  isProcessing = true;
  liveDot.style.display = 'none';
  appendUserMessage(text);

  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;
  micBtn.disabled = true;

  if (qCount >= MAX_Q) { await endInterview(); return; }

  setStatus('thinking', 'Alex is thinking…');
  appendTyping();

  const res = await window.api.llm.sendMessage(text);
  removeTyping();

  if (!res.ok) {
    toast('AI error: ' + res.error);
    isProcessing = false;
    if (sendBtn) sendBtn.disabled = false;
    micBtn.disabled = !micStream;
    setReadyToListen();
    return;
  }

  const aiText = res.message;
  appendAIMessage(aiText);
  qCount++;
  updateProgress();

  const endSignals = ['thank you for your time', 'that covers everything', 'that wraps up'];
  const isEnd = endSignals.some(p => aiText.toLowerCase().includes(p));

  isProcessing = false;
  if (sendBtn) sendBtn.disabled = false;

  if (isEnd || qCount > MAX_Q) {
    await speakAI(aiText);
    setTimeout(endInterview, 800);
  } else {
    await speakAI(aiText);
    if (!sessionEnded && !isProcessing) setReadyToListen();
  }
}

// ── Status helpers ─────────────────────────────────────────────────────────────
function setStatus(mode, label) {
  statusTxt.textContent = label;
  statusDot.className   = 'dot';
  waveform.className    = 'waveform';
  aiFace.classList.remove('speaking');
  const sendBtn = document.getElementById('sendBtn');

  if (mode === 'speaking') {
    statusDot.classList.add('dot-green');
    aiFace.classList.add('speaking');
    micBtn.disabled      = true;
    micLabel.textContent = 'AI is speaking…';
    if (sendBtn) sendBtn.disabled = true;
  } else if (mode === 'listening') {
    statusDot.classList.add('dot-red');
    waveform.className   = 'waveform user';
    micBtn.disabled      = false;
    if (sendBtn) sendBtn.disabled = false;
  } else if (mode === 'thinking') {
    statusDot.classList.add('dot-green');
    waveform.className   = 'waveform idle';
    micBtn.disabled      = true;
    micLabel.textContent = 'Processing…';
    if (sendBtn) sendBtn.disabled = true;
  } else {
    statusDot.className   = 'dot dot-muted';
    waveform.className    = 'waveform idle';
    liveDot.style.display = 'none';
  }
}

function setReadyToListen() {
  setStatus('idle', 'Your turn');
  micBtn.disabled       = !micStream;
  micLabel.textContent  = micStream ? 'Press 🎙️ or type below' : 'Type answer below';
  liveDot.style.display = 'none';
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = false;
  const inp = document.getElementById('txtInput');
  if (inp) inp.focus();
}

// ── Timer & progress ──────────────────────────────────────────────────────────
function startTimer() {
  const s0 = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - s0) / 1000);
    timerEl.textContent =
      String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
  }, 1000);
}

function updateProgress() {
  const pct = Math.min((qCount / MAX_Q) * 100, 100);
  progFill.style.width  = pct + '%';
  progLabel.textContent = qCount + ' / ' + MAX_Q;
}

// ── TTS ───────────────────────────────────────────────────────────────────────
async function speakAI(text) {
  setStatus('speaking', 'Alex is speaking…');
  await window.api.tts.speak(text);
}

// ── Messages ──────────────────────────────────────────────────────────────────
function appendAIMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg fade-in';
  el.innerHTML = '<div class="msg-avatar">🤵</div><div>' +
    '<div class="msg-bubble">' + escHtml(text) + '</div>' +
    '<div class="msg-time">' + timeNow() + ' · Alex</div></div>';
  feed.appendChild(el); scrollFeed();
}
function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg user fade-in';
  el.innerHTML = '<div class="msg-avatar">👤</div><div>' +
    '<div class="msg-bubble">' + escHtml(text) + '</div>' +
    '<div class="msg-time">' + timeNow() + ' · You</div></div>';
  feed.appendChild(el); scrollFeed();
}
function appendTyping() {
  const el = document.createElement('div');
  el.className = 'msg'; el.id = 'typingMsg';
  el.innerHTML = '<div class="msg-avatar">🤵</div>' +
    '<div class="typing-indicator"><div class="typing-dot"></div>' +
    '<div class="typing-dot"></div><div class="typing-dot"></div></div>';
  feed.appendChild(el); scrollFeed();
}
function removeTyping() { const e = document.getElementById('typingMsg'); if (e) e.remove(); }
function scrollFeed()   { requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; }); }

// ── End interview ──────────────────────────────────────────────────────────────
async function endInterview() {
  if (sessionEnded) return;
  sessionEnded = true;
  clearInterval(timerInterval);
  if (isListening) stopListening();
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }

  setStatus('thinking', 'Generating feedback…');
  appendTyping();
  await window.api.llm.endSession();
  const fbRes = await window.api.llm.generateFeedback();
  removeTyping();
  if (fbRes.ok && fbRes.feedback) await window.api.store.set('lastFeedback', fbRes.feedback);
  await window.api.navigate('feedback');
}

function confirmEnd() {
  if (sessionEnded) return;
  if (confirm('End interview and view feedback?')) endInterview();
}

function skipTurn() {
  if (isProcessing || sessionEnded) return;
  window.api.tts.stop();
  if (isListening) stopListening();
  processAnswer('I would like to skip this question.');
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.matches('#txtInput')) return;
  if (e.code === 'Space' && !isListening && !micBtn.disabled) {
    e.preventDefault(); startListening();
  }
});
document.addEventListener('keyup', e => {
  if (e.target.matches('#txtInput')) return;
  if (e.code === 'Space' && isListening) {
    e.preventDefault(); stopListening();
  }
});

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}
function timeNow() {
  return new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
}
function toast(msg, dur) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), dur || 5000);
}

init();