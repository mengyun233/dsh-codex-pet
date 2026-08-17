'use strict'
const { app, BrowserWindow, ipcMain, screen, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')

const DSH_API = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PETS_DIR = process.env.DSH_PETS || path.join(DSH_HOME, 'pets')
// Shared settings written by the DSH web settings panel (pet.json -> codexPet).
const SHARED_CFG_PATH = path.join(DSH_HOME, 'pet.json')
// Desktop-only settings (window position) kept separate.
const CONFIG_PATH = path.join(DSH_HOME, 'pet.desktop.json')

let win = null
let config = {}          // merged view: shared codexPet + desktop position
let desktopOnly = {}     // pet.desktop.json (x/y)
let pollTimer = null
let configWatchTimer = null
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
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** Shared settings from the DSH web panel ($DSH_HOME/pet.json -> codexPet). */
function readSharedConfig() {
  const data = readJsonFile(SHARED_CFG_PATH)
  return (data && typeof data.codexPet === 'object' && data.codexPet) || {}
}

function loadDesktopOnly() {
  desktopOnly = readJsonFile(CONFIG_PATH) || {}
  return desktopOnly
}

function saveDesktopOnly() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(desktopOnly, null, 2), 'utf8')
  } catch (e) {
    console.error('pet.desktop: save desktop config failed', e)
  }
}

/** Merge shared codexPet settings with desktop-only position. */
function mergeConfig() {
  return { ...readSharedConfig(), ...desktopOnly }
}

/** Send current merged config to the renderer. */
function pushConfig() {
  if (win && !win.isDestroyed()) win.webContents.send('pet:config', config)
}

/** Apply window-level settings (scale / alwaysOnTop / clickThrough). */
function applyWindowSettings() {
  if (!win || win.isDestroyed()) return
  const scale = typeof config.scale === 'number' ? config.scale : 1
  win.setSize(Math.max(262, Math.round(280 * scale)), Math.max(180, Math.round(340 * scale)))
  win.setAlwaysOnTop(config.alwaysOnTop !== false, 'screen-saver')
  // clickThrough forces full passthrough; otherwise the renderer toggles
  // interactive areas (pet/dialogs) vs blank transparent pixels.
  applyMousePassthrough()
}

let mousePassthrough = false
/** Sync ignoreMouseEvents: forced by clickThrough, else hover-driven. */
function applyMousePassthrough() {
  if (!win || win.isDestroyed()) return
  const ignore = config.clickThrough === true || mousePassthrough
  win.setIgnoreMouseEvents(ignore, { forward: true })
}

/** Renderer reports whether the cursor is over an interactive element. */
ipcMain.handle('pet:setHover', (_e, interactive) => {
  mousePassthrough = !interactive
  applyMousePassthrough()
})

/** Refresh merged config from disk and push changes to the renderer. */
function reloadConfig() {
  const next = mergeConfig()
  const prevKey = JSON.stringify(config)
  const nextKey = JSON.stringify(next)
  if (prevKey === nextKey) return
  config = next
  applyWindowSettings()
  pushConfig()
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
  loadDesktopOnly()
  config = mergeConfig()
  const scale = typeof config.scale === 'number' ? config.scale : 1

  win = new BrowserWindow({
    // Window must fit the pet sprite AND the 240px dialogs anchored under its
    // feet. Base design size is 280x340; never shrink below 262 wide so the
    // 240px dialogs stay fully visible.
    width: Math.max(262, Math.round(280 * scale)),
    height: Math.max(180, Math.round(340 * scale)),
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
  applyMousePassthrough()

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
  config = mergeConfig()
  return config
})
// Desktop-only settings (position) persisted to pet.desktop.json; shared
// settings live in pet.json and are owned by the web settings panel.
ipcMain.handle('pet:saveDesktop', (_e, patch) => {
  desktopOnly = { ...desktopOnly, ...(patch || {}) }
  saveDesktopOnly()
  config = mergeConfig()
  applyWindowSettings()
  pushConfig()
  return config
})
// The renderer tells us the pet sprite's real footprint so the window exactly
// fits sprite + dialog strip (no clipping at small scales).
ipcMain.handle('pet:fitWindow', (_e, spriteW, spriteH, maxGap) => {
  if (!win || win.isDestroyed()) return
  const scale = typeof config.scale === 'number' ? config.scale : 1
  const w = Math.max(262, Math.round((spriteW || 260) + 16))
  const h = Math.max(180, Math.round((spriteH || 300) + (maxGap || 0) + 60))
  win.setSize(w, h)
})
// Write shared settings (pet.json -> codexPet) back to disk and apply them.
function writeSharedConfig(shared) {
  try {
    const whole = readJsonFile(SHARED_CFG_PATH) || {}
    whole.codexPet = shared
    fs.writeFileSync(SHARED_CFG_PATH, JSON.stringify(whole, null, 2), 'utf8')
  } catch (e) {
    console.error('pet.desktop: save shared config failed', e)
  }
  config = mergeConfig()
  applyWindowSettings()
  pushConfig()
}

// Menu toggles in the desktop app write back to the SHARED settings
// (pet.json -> codexPet) so web and desktop modes always agree.
ipcMain.handle('pet:saveShared', (_e, patch) => {
  const shared = readSharedConfig()
  Object.assign(shared, patch || {})
  writeSharedConfig(shared)
  return config
})
ipcMain.handle('pet:moveBy', (_e, dx, dy) => {
  if (!win || win.isDestroyed()) return
  const [wx, wy] = win.getPosition()
  const nx = Math.round(wx + (Number.isFinite(dx) ? dx : 0))
  const ny = Math.round(wy + (Number.isFinite(dy) ? dy : 0))
  win.setPosition(nx, ny)
  desktopOnly.x = nx
  desktopOnly.y = ny
  saveDesktopOnly()
})
ipcMain.handle('pet:state', async () => {
  try {
    const r = await fetch(`${DSH_API}/dsh-pets/api/state`)
    if (r.ok) return r.json()
  } catch { /* not running */ }
  return null
})
// Double-click on a dialog: open the DSH web app at that session (same as the
// web overlay's jump-to-session behavior).
ipcMain.handle('pet:openSession', async (_e, sessionId) => {
  if (!sessionId) return { ok: false }
  try {
    await shell.openExternal(`${DSH_API}/?session=${encodeURIComponent(sessionId)}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})
// Stop button: actually cancel the agent via the DSH host API.
ipcMain.handle('pet:stopSession', async (_e, sessionId) => {
  try {
    const r = await fetch(`${DSH_API}/dsh-pets/api/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sessionId ? { sessionId } : {})
    })
    if (r.ok) return r.json()
    return { ok: false }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
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
// Native context menu (popup, never clipped by the small transparent window).
ipcMain.handle('pet:showMenu', (_e, x, y) => {
  if (!win || win.isDestroyed()) return
  const template = [
    {
      label: '随机散步',
      click: () => { if (!win.isDestroyed()) win.webContents.send('pet:menu', 'walk') }
    },
    {
      label: '摸摸',
      click: () => { if (!win.isDestroyed()) win.webContents.send('pet:menu', 'pet') }
    },
    { type: 'separator' },
    {
      label: config.alwaysOnTop !== false ? '置顶: 开' : '置顶: 关',
      click: () => {
        config.alwaysOnTop = config.alwaysOnTop !== false ? false : true
        const shared = readSharedConfig()
        shared.alwaysOnTop = config.alwaysOnTop
        writeSharedConfig(shared)
      }
    },
    {
      label: config.clickThrough ? '点击穿透: 开' : '点击穿透: 关',
      click: () => {
        config.clickThrough = !config.clickThrough
        const shared = readSharedConfig()
        shared.clickThrough = config.clickThrough
        writeSharedConfig(shared)
      }
    },
    { type: 'separator' },
    {
      label: '重新扫描皮肤',
      click: () => { if (!win.isDestroyed()) win.webContents.send('pet:menu', 'refresh') }
    },
    {
      label: '退出桌宠',
      click: () => app.quit()
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  // No x/y: the menu pops at the current mouse position, which is exactly
  // where the user right-clicked — avoids client/screen coordinate confusion.
  menu.popup({ window: win })
})

// ---------- lifecycle ----------
app.whenReady().then(() => {
  scanPets()
  createWindow()
  pollState()
  pollTimer = setInterval(pollState, 1000)
  // Watch the shared web-panel settings so changes apply live to the desktop pet.
  configWatchTimer = setInterval(reloadConfig, 1500)
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer)
  if (configWatchTimer) clearInterval(configWatchTimer)
})
