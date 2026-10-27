// Electron main process: one window, game files served over app://, saves stored as JSON in the user folder.
const { app, BrowserWindow, protocol, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const SRC = path.join(__dirname, 'src');
const SAVES = () => path.join(app.getPath('userData'), 'saves');
const PROFILE = () => path.join(app.getPath('userData'), 'profile.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const safeName = n => String(n).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Save';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1100, minHeight: 680, show: false, backgroundColor: '#0b1620',
    title: 'Wheel of Nations', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    if (input.control && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://game/index.html');
  return win;
}

app.whenReady().then(async () => {
  protocol.handle('app', async req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(SRC, decodeURIComponent(pathname)));
    if (!file.startsWith(SRC)) return new Response('Forbidden', { status: 403 });
    try { const body = await fs.readFile(file); return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  await fs.mkdir(SAVES(), { recursive: true });

  ipcMain.handle('saves:list', async () => {
    const out = [];
    for (const f of await fs.readdir(SAVES())) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(SAVES(), f);
      try {
        const [stat, text] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')]);
        const m = /"meta"\s*:\s*(\{[^{}]*\})/.exec(text.slice(0, 2000));
        out.push({ name: f.slice(0, -5), meta: m ? JSON.parse(m[1]) : {}, mtime: stat.mtimeMs });
      } catch {}
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  });
  ipcMain.handle('saves:write', async (e, name, text) => {
    const file = path.join(SAVES(), safeName(name) + '.json'), tmp = file + '.tmp';
    await fs.writeFile(tmp, text, 'utf8'); await fs.rename(tmp, file); return true;
  });
  ipcMain.handle('saves:read', async (e, name) => fs.readFile(path.join(SAVES(), safeName(name) + '.json'), 'utf8').catch(() => null));
  ipcMain.handle('saves:delete', async (e, name) => { await fs.rm(path.join(SAVES(), safeName(name) + '.json'), { force: true }); return true; });
  ipcMain.handle('saves:open', () => shell.openPath(SAVES()));
  ipcMain.handle('profile:read', () => fs.readFile(PROFILE(), 'utf8').catch(() => null));
  ipcMain.handle('profile:write', async (e, text) => { await fs.writeFile(PROFILE(), text, 'utf8'); return true; });
  ipcMain.handle('win:fullscreen', e => { const w = BrowserWindow.fromWebContents(e.sender); w.setFullScreen(!w.isFullScreen()); });
  ipcMain.handle('app:quit', () => app.quit());

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
