'use strict'
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')

const DSH_API = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080'
const PETS_DIR = process.env.DSH_PETS || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'pets')
const CONFIG_PATH = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'pet.desktop.json')

let win = null
let config = {}
let pollTimer = null
let petList = []

// ---------- taskbar hiding (Windows native fallback) ----------
function applyToolWindow(hwnd) {
  const GWL_EXSTYLE = -20
  const WS_EX_TOOLWINDOW = 0x00000080
  execFile('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class P{[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);[DllImport("user32.dll")]public static extern int SetWindowLong(IntPtr h,int i,int v);}'; $h=[IntPtr]${hwnd}; $e=[P]::GetWindowLong($h,-20); [P]::SetWindowLong($h,-20,($e -bor 0x80))`
  ], { windowsHide: true }, () => {})
}

// ---------- config ----------
function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}
  } catch {
    config = {}
  }
  return config
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('pet.desktop: save config failed', e)
  }
}

// ---------- pet list from DSH pets dir ----------
function scanPets() {
  const pets = []
  let dirs = []
  try {
    dirs = fs.readdirSync(PETS_DIR, { withFileTypes: true })
  } catch {
    dirs = []
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = d.name
    const pj = path.join(PETS_DIR, dir, 'pet.json')
    const sw = path.join(PETS_DIR, dir, 'spritesheet.webp')
    if (!fs.existsSync(pj) || !fs.existsSync(sw)) continue
    let meta = {}
    try {
      meta = JSON.parse(fs.readFileSync(pj, 'utf8').replace(/^\uFEFF/, ''))
    } catch { /* keep */ }
    pets.push({
      id: meta.id || dir,
      dir,
      displayName: meta.displayName || dir,
      description: meta.description || '',
      sheetPath: sw
    })
  }
  petList = pets
  return pets
}

// ---------- state polling from DSH host ----------
let lastStateKey = ''
function pollState() {
  const controller = new AbortController()
  const to = setTimeout(() => controller.abort(), 3000)
  fetch(`${DSH_API}/dsh-pets/api/state`, { signal: controller.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return
      const key = d.phase + '|' + d.phrase + '|' + (d.project || '') + '|' + ((d.sessions || []).length)
      if (key !== lastStateKey) {
        lastStateKey = key
        if (win && !win.isDestroyed()) win.webContents.send('pet:state', d)
      }
    })
    .catch(() => { /* DSH not running; pet stays idle */ })
    .finally(() => clearTimeout(to))
}

// ---------- window ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  loadConfig()

  win = new BrowserWindow({
    width: Math.round((config.scale || 1) * 260),
    height: Math.round((config.scale || 1) * 300),
    x: config.x ?? workArea.x + workArea.width - 320,
    y: config.y ?? workArea.y + workArea.height - 360,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop !== false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true
    }
  })

  win.setAlwaysOnTop(config.alwaysOnTop !== false, 'screen-saver')
  // Transparent windows can lose the skipTaskbar style on Windows; force it
  // both via the Electron API and by re-applying WS_EX_TOOLWINDOW after show.
  win.setSkipTaskbar(true)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      try {
        const hwndBuf = win.getNativeWindowHandle()
        if (hwndBuf && hwndBuf.length >= 4) {
          const handle = hwndBuf.readInt32LE(0) & 0xffffffff
          applyToolWindow(handle)
        }
      } catch { /* ignore */ }
    }, 500)
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.setIgnoreMouseEvents(config.clickThrough === true, { forward: true })

  // diagnostics: forward renderer console to a log file
  const logPath = path.join(os.tmpdir(), 'dsh-codex-pet-renderer.log')
  win.webContents.on('console-message', (_e, level, message) => {
    try {
      fs.appendFileSync(logPath, `[${level}] ${message}\n`)
    } catch { /* ignore */ }
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    try { fs.appendFileSync(logPath, `[load-fail] ${code} ${desc}\n`) } catch { /* ignore */ }
  })

  win.on('closed', () => { win = null })
  return win
}

// ---------- IPC ----------
ipcMain.handle('pet:list', () => scanPets())
ipcMain.handle('pet:getConfig', () => {
  loadConfig()
  return config
})
ipcMain.handle('pet:saveConfig', (_e, patch) => {
  config = { ...config, ...(patch || {}) }
  saveConfig()
  if (win && !win.isDestroyed()) {
    if (typeof config.alwaysOnTop === 'boolean') win.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver')
    if (typeof config.clickThrough === 'boolean') win.setIgnoreMouseEvents(config.clickThrough, { forward: true })
    if (typeof config.x === 'number' && typeof config.y === 'number') win.setPosition(Math.round(config.x), Math.round(config.y))
    if (typeof patch.scale === 'number') {
      win.setSize(Math.round(patch.scale * 260), Math.round(patch.scale * 300))
    }
  }
  return config
})
ipcMain.handle('pet:moveBy', (_e, dx, dy) => {
  if (!win || win.isDestroyed()) return
  const [wx, wy] = win.getPosition()
  const nx = Math.round(wx + (Number.isFinite(dx) ? dx : 0))
  const ny = Math.round(wy + (Number.isFinite(dy) ? dy : 0))
  win.setPosition(nx, ny)
  config.x = nx
  config.y = ny
  saveConfig()
})
ipcMain.handle('pet:state', async () => {
  try {
    const r = await fetch(`${DSH_API}/dsh-pets/api/state`)
    if (r.ok) return r.json()
  } catch { /* not running */ }
  return null
})
ipcMain.handle('pet:sheet', (_e, dir) => {
  const p = path.join(PETS_DIR, dir || '', 'spritesheet.webp')
  try {
    const buf = fs.readFileSync(p)
    return { ok: true, mime: 'image/webp', data: buf.toString('base64') }
  } catch {
    return { ok: false }
  }
})
ipcMain.handle('pet:readPetJson', (_e, dir) => {
  const p = path.join(PETS_DIR, dir || '', 'pet.json')
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
})
ipcMain.handle('pet:quit', () => app.quit())

// ---------- lifecycle ----------
app.whenReady().then(() => {
  scanPets()
  createWindow()
  pollState()
  pollTimer = setInterval(pollState, 1000)
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer)
})
