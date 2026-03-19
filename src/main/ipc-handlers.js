// src/main/ipc-handlers.js
const { ipcMain, dialog, app, BrowserWindow } = require('electron');
const path = require('path');

const llm    = require('./llm-service');
const tts    = require('./tts-service');
const stt    = require('./stt-service');
const resume = require('./resume-service');

function register(mainWindow, store) {

  // ── Window controls ──────────────────────────────────────────────────────────
  ipcMain.handle('win:minimize', () => mainWindow.minimize());
  ipcMain.handle('win:maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('win:close',  () => mainWindow.close());
  ipcMain.handle('win:is-max', () => mainWindow.isMaximized());

  // ── Navigation ───────────────────────────────────────────────────────────────
  ipcMain.handle('navigate', (_e, page) => {
    const file = path.join(global.appRoot, 'src', 'renderer', 'pages', `${page}.html`);
    mainWindow.loadFile(file);
  });

  // ── LLM ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('llm:is-ready', () => llm.isLLMReady());

  ipcMain.handle('llm:start-session', async (_e, config) => {
    try {
      const msg = await llm.startInterviewSession(config);
      return { ok: true, message: msg };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('llm:send-message', async (_e, userMsg) => {
    try {
      const msg = await llm.sendMessage(userMsg);
      return { ok: true, message: msg };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('llm:generate-feedback', async () => {
    try {
      const feedback = await llm.generateFeedback();
      return { ok: true, feedback };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('llm:end-session', () => {
    const history = llm.getHistory();
    store.set('lastInterview', {
      history,
      timestamp: Date.now(),
      questions: llm.getQuestionCount(),
    });
    // Update stats
    const stats = store.get('stats') || { total: 0 };
    stats.total = (stats.total || 0) + 1;
    stats.lastTimestamp = Date.now();
    store.set('stats', stats);
    return { ok: true };
  });

  // ── TTS ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('tts:speak', async (_e, text) => {
    await tts.speak(text);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('tts:done');
    return { ok: true };
  });
  ipcMain.handle('tts:stop',       () => { tts.stop(); return { ok: true }; });
  ipcMain.handle('tts:is-speaking',() => tts.isSpeaking());

  // ── STT ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('stt:transcribe', async (_e, wavBuffer) => {
    try {
      const text = await stt.transcribeAudio(wavBuffer);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Resume ───────────────────────────────────────────────────────────────────
  ipcMain.handle('resume:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Upload Your Resume',
      filters: [{ name: 'Documents', extensions: ['pdf', 'txt'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return { canceled: true };
    try {
      const parsed = await resume.parseResume(result.filePaths[0]);
      return { ok: true, ...parsed };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Store ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('store:get', (_e, key)        => store.get(key));
  ipcMain.handle('store:set', (_e, key, value) => { store.set(key, value); return true; });
  ipcMain.handle('store:del', (_e, key)        => { store.delete(key); return true; });
}

module.exports = { register };