const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // ── Window controls ──────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close:    () => ipcRenderer.invoke('win:close'),
    isMax:    () => ipcRenderer.invoke('win:is-max'),
  },

  // ── Navigation ───────────────────────────────────────────────────────────────
  navigate: (page) => ipcRenderer.invoke('navigate', page),

  // ── LLM ─────────────────────────────────────────────────────────────────────
  llm: {
    isReady:         ()       => ipcRenderer.invoke('llm:is-ready'),
    startSession:    (config) => ipcRenderer.invoke('llm:start-session', config),
    sendMessage:     (msg)    => ipcRenderer.invoke('llm:send-message', msg),
    generateFeedback:()       => ipcRenderer.invoke('llm:generate-feedback'),
    endSession:      ()       => ipcRenderer.invoke('llm:end-session'),
  },

  // ── STT ──────────────────────────────────────────────────────────────────────
  stt: {
    // float32Array is a Float32Array from AudioContext — convert to plain Array
    // so Electron IPC can serialise it correctly across the context bridge
    transcribe: (float32Array) => ipcRenderer.invoke(
      'stt:transcribe',
      Array.from(float32Array)
    ),
  },

  // ── TTS ──────────────────────────────────────────────────────────────────────
  tts: {
    speak:     (text) => ipcRenderer.invoke('tts:speak', text),
    stop:      ()     => ipcRenderer.invoke('tts:stop'),
    isSpeaking:()     => ipcRenderer.invoke('tts:is-speaking'),
  },

  // ── Resume ───────────────────────────────────────────────────────────────────
  resume: {
    openDialog: () => ipcRenderer.invoke('resume:open-dialog'),
  },

  // ── Store ────────────────────────────────────────────────────────────────────
  store: {
    get:   (key)        => ipcRenderer.invoke('store:get', key),
    set:   (key, value) => ipcRenderer.invoke('store:set', key, value),
    del:   (key)        => ipcRenderer.invoke('store:del', key),
  },

  // ── Events from main ─────────────────────────────────────────────────────────
  on: (channel, cb) => {
    const allowed = ['llm:ready', 'llm:not-found', 'llm:error', 'tts:done'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },
  off: (channel, cb) => {
    ipcRenderer.removeListener(channel, cb);
  },
});