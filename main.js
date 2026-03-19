const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path  = require('path');
const Store = require('electron-store');

const store = new Store();
let mainWindow;

// ── Path resolver ─────────────────────────────────────────────────────────────
function getResourcePath(...parts) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...parts);
  return path.join(__dirname, ...parts);
}
global.getResourcePath = getResourcePath;
global.appRoot = __dirname;

// ── Electron flags for Speech Recognition + Mic ───────────────────────────────
// These must be set before app 'ready'
app.commandLine.appendSwitch('enable-speech-input');
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); // auto-grants mic permission dialog

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
  });

  // ── Grant microphone + speech permissions automatically ───────────────────
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audio-capture', 'speech-recognition'];
    console.log('[PERM] requested:', permission, '→', allowed.includes(permission) ? 'granted' : 'denied');
    callback(allowed.includes(permission));
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'microphone', 'audio-capture', 'speech-recognition'];
    return allowed.includes(permission);
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'pages', 'home.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();

  const { register } = require('./src/main/ipc-handlers');
  register(mainWindow, store);

  const { initLLM } = require('./src/main/llm-service');
  initLLM()
    .then(ok => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send(ok ? 'llm:ready' : 'llm:not-found');
    })
    .catch(err => {
      console.error('LLM init error:', err.message);
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send('llm:error', err.message);
    });
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

global.navigate = (page) => {
  const filePath = path.join(__dirname, 'src', 'renderer', 'pages', `${page}.html`);
  mainWindow.loadFile(filePath);
};