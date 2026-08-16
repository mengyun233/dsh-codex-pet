'use strict'

// ---------- small helpers ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function isActivePhase(ph) {
  return ph === 'thinking' || ph === 'tool' || ph === 'working' || ph === 'waiting' || ph === 'starting'
}

function phaseBubbleText(ph, phrase) {
  switch (ph) {
    case 'starting': return '启动中'
    case 'thinking': return '思考中'
    case 'tool': return phrase || '正在使用工具'
    case 'working': return phrase || '工作中'
    case 'waiting': return phrase || '等待指令'
    case 'done': return phrase || '完成'
    case 'failed': return '出错了'
    case 'sleeping': return 'Zzz…'
    default: return ''
  }
}

// ---------- tracks ----------
const TRACKS = {
  0: { name: 'idle', loop: true, ms: 140 },
  1: { name: 'running-right', loop: true, ms: 85 },
  2: { name: 'running-left', loop: true, ms: 85 },
  3: { name: 'waving', loop: false, ms: 110 },
  4: { name: 'jumping', loop: false, ms: 110 },
  5: { name: 'failed', loop: false, ms: 130 },
  6: { name: 'waiting', loop: true, ms: 140 },
  7: { name: 'running', loop: true, ms: 85 },
  8: { name: 'review', loop: false, ms: 120 },
  9: { name: 'look-left', loop: false, ms: 0 },
  10: { name: 'look-right', loop: false, ms: 0 }
}
const FLIP_ROWS = { 0: true, 3: true, 4: true, 5: true, 6: true, 8: true }

// ---------- element refs ----------
const petImg = document.getElementById('pet')
const bubble = document.getElementById('bubble')
const dialogsEl = document.getElementById('dialogs')
const menuEl = document.getElementById('menu')
const menuTitle = document.getElementById('menu-title')

// ---------- state ----------
const state = {
  pets: [],
  active: null,
  config: {},
  phase: 'idle',
  phrase: '',
  sessions: [],
  lastEvent: ''
}
const anim = {
  row: 0,
  frame: 0,
  queue: [],
  queueStart: 0,
  sleeping: false,
  walkUntil: 0,
  walkDir: 1,
  x: 0, // in-window pet x
  facing: 1
}
const frames = { list: [], cols: 8, rows: 0, rowLen: [], gaps: [], maxGap: 0, w: 0, h: 0 }
let drag = null
let lastDrawn = { row: -1, frame: -1 }
let lastFrameAt = 0
let lastEventAt = Date.now()
let collapsed = {}
let dismissed = {}
let prevPhases = {}
let clickTimers = {}

function loadConfig() {
  return window.petHost.getConfig().then((c) => {
    state.config = c || {}
    const w = Math.round((state.config.scale || 1) * 260)
    const h = Math.round((state.config.scale || 1) * 300)
    // window size fixed at creation; just apply visual scale via frames build
    return c
  })
}

function saveConfig(patch) {
  // Shared settings (alwaysOnTop / clickThrough / skin / speed / ...) write
  // back to pet.json via saveShared; desktop-only position uses saveDesktop.
  return window.petHost.saveShared(patch || {}).then((c) => { state.config = c || {} })
}

// ---------- skin loading ----------
function loadSkin(dir) {
  return window.petHost.sheet(dir).then((res) => {
    if (!res || !res.ok) throw new Error('sheet missing')
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = 'data:' + res.mime + ';base64,' + res.data
    })
  })
}

function deriveGrid(w, h) {
  const cols = 8
  const cellW = w / cols
  let rows = null
  let cellH = null
  if (h % 208 === 0) { rows = h / 208; cellH = 208 }
  else {
    for (let r = 1; r <= 32; r++) {
      const ch = h / r
      if (Number.isInteger(ch) && Math.abs(ch - cellW) / cellW < 0.25) { rows = r; cellH = ch; break }
    }
  }
  if (!rows) { rows = Math.max(1, Math.round(h / cellW)); cellH = h / rows }
  return { cols, rows, cellW, cellH }
}

function buildFrames(img, g, scale) {
  const cols = 8
  const w = Math.max(1, Math.round(g.cellW * scale))
  const h = Math.max(1, Math.round(g.cellH * scale))
  const list = []
  const rowLen = []
  const gaps = []
  let maxGap = 0
  for (let r = 0; r < g.rows; r++) {
    let firstEmpty = cols
    for (let f = 0; f < cols; f++) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const cx = c.getContext('2d')
      cx.imageSmoothingEnabled = false
      cx.drawImage(img, f * g.cellW, r * g.cellH, g.cellW, g.cellH, 0, 0, w, h)
      list.push(c.toDataURL('image/png'))
      let nz = 0
      let lowest = -1
      try {
        const px = cx.getImageData(0, 0, w, h).data
        for (let y = 0; y < h; y++) {
          let rowNz = 0
          for (let x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] > 0) rowNz++
          }
          if (rowNz > 0) { nz += rowNz; lowest = y }
        }
      } catch (e) { /* ignore */ }
      if (nz / (w * h) < 0.001 && firstEmpty === cols) firstEmpty = f
      const gap = lowest < 0 ? h : (h - 1 - lowest)
      gaps.push(gap)
      if (gap > maxGap) maxGap = gap
    }
    rowLen.push(Math.max(1, firstEmpty))
  }
  return { list, cols, rows: g.rows, rowLen, gaps, maxGap, w, h }
}

async function applyActiveSkin() {
  if (!state.active) return
  const scale = state.config.scale || 1
  try {
    const img = await loadSkin(state.active)
    const g = deriveGrid(img.naturalWidth, img.naturalHeight)
    const fr = buildFrames(img, g, scale)
    Object.assign(frames, fr)
    // position pet with its feet just above the dialog strip at the window
    // bottom (strip starts ~52px from the bottom)
    petImg.style.width = frames.w + 'px'
    petImg.style.height = frames.h + 'px'
    anim.x = Math.max(0, Math.round((window.innerWidth - frames.w) / 2))
    petImg.style.left = anim.x + 'px'
    petImg.style.top = (window.innerHeight - frames.h - frames.maxGap - 56) + 'px'
    // ask main to size the window to exactly fit sprite + dialog strip
    window.petHost.fitWindow(frames.w, frames.h, frames.maxGap).catch(() => {})
    lastDrawn = { row: -1, frame: -1 }
    showFrame(anim.row, anim.frame)
  } catch (e) {
    console.error('applyActiveSkin failed', e)
  }
}

/** Apply a merged-config update coming from the main process (web panel edits, etc.). */
function applyConfig(next) {
  if (!next) return
  const prevName = state.config.name
  const prevScale = state.config.scale
  const prevActive = state.active
  state.config = next || {}
  const wants = (next.name && state.pets.some((p) => p.dir === next.name)) ? next.name : state.active
  if (wants !== state.active) {
    state.active = wants
    if (state.active) applyActiveSkin()
  } else if (prevScale !== next.scale || (prevName !== next.name && next.name === state.active)) {
    if (state.active) applyActiveSkin()
  }
  syncMenuLabels()
}

function showFrame(row, frame) {
  const idx = row * frames.cols + frame
  const src = frames.list[idx]
  if (!src) return
  if (petImg.src !== src) petImg.src = src
  petImg.style.marginTop = (frames.maxGap - frames.gaps[idx]) + 'px'
}

function playSeq(rows) {
  anim.queue = rows.map((r) => ({ row: r[0], ms: r[1] }))
  anim.queueStart = 0
}

// ---------- dialogs ----------
function renderDialogs() {
  const sorted = (state.sessions || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0))
  const shown = sorted.filter((ss) => ss.phase !== 'idle' && !dismissed[ss.id]).slice(0, 5)

  // Dialogs live in a fixed strip at the window bottom (last ~56px), anchored
  // to the pet's horizontal center. The pet sprite is drawn above this strip.
  const dialogLeft = clamp(window.innerWidth / 2, 130, Math.max(130, window.innerWidth - 130))
  const stripBottom = window.innerHeight - 6

  dialogsEl.innerHTML = ''
  shown.forEach((ss, idx) => {
    const isCollapsed = !!collapsed[ss.id]
    const canStop = isActivePhase(ss.phase)
    const statusIcon = ss.phase === 'done' ? '✓' : ss.phase === 'failed' ? '!' : null
    const statusCls = ss.phase === 'done' ? 'ok' : ss.phase === 'failed' ? 'err' : ''
    const activeTxt = isActivePhase(ss.phase)
    const activity = isCollapsed ? '' : (activeTxt && ss.text ? ss.text : (phaseBubbleText(ss.phase, ss.phrase) || '正在待机'))
    const rowH = isCollapsed ? 24 : 46
    const top = Math.max(4, stripBottom - (rowH + 6) - idx * (rowH + 6))

    const dlg = document.createElement('div')
    dlg.className = 'dialog' + (isCollapsed ? ' collapsed' : '')
    dlg.style.top = top + 'px'
    dlg.style.left = dialogLeft + 'px'
    dlg.style.transform = 'translateX(-50%)'
    dlg.dataset.sid = ss.id
    // Single click = toggle collapse; double click = jump + dismiss.
    // No hover re-render: the stop button is shown via CSS :hover so clicks
    // are never lost to a rebuilt subtree.
    dlg.onclick = () => {
      const t = clickTimers[ss.id]
      if (t) {
        clearTimeout(t)
        delete clickTimers[ss.id]
        return
      }
      clickTimers[ss.id] = setTimeout(() => {
        delete clickTimers[ss.id]
        collapsed[ss.id] = !collapsed[ss.id]
        renderDialogs()
      }, 220)
    }
    dlg.ondblclick = () => {
      const t = clickTimers[ss.id]
      if (t) { clearTimeout(t); delete clickTimers[ss.id] }
      dismissed[ss.id] = true
      renderDialogs()
      // Jump to the session in the DSH web app (same as the web overlay),
      // then the bubble stays dismissed until that session turns active again.
      if (ss.id) window.petHost.openSession(ss.id).catch(() => {})
    }
    // Right-click = close this dialog bubble (dismiss without jumping).
    dlg.oncontextmenu = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const t = clickTimers[ss.id]
      if (t) { clearTimeout(t); delete clickTimers[ss.id] }
      dismissed[ss.id] = true
      renderDialogs()
    }

    const body = document.createElement('div')
    body.className = 'dialog-body'
    const pj = document.createElement('div')
    pj.className = 'dialog-project'
    pj.textContent = ss.project || 'DSH'
    body.appendChild(pj)
    if (!isCollapsed) {
      const doing = document.createElement('div')
      doing.className = 'dialog-doing'
      doing.textContent = activity
      body.appendChild(doing)
    }
    dlg.appendChild(body)

    if (canStop) {
      // Rendered always (so clicks hit it), shown only while hovering via CSS.
      const stop = document.createElement('button')
      stop.type = 'button'
      stop.className = 'dialog-stop'
      stop.title = '终止对话'
      stop.textContent = '⏹'
      stop.onclick = (e) => {
        e.stopPropagation()
        window.petHost.stopSession(ss.id).then((r) => {
          setBubble((r && r.ok) ? '已停止' : '无法停止')
        }).catch(() => {
          setBubble('停止失败')
        })
        setTimeout(() => setBubble(null), 1500)
      }
      dlg.appendChild(stop)
    } else if (statusIcon) {
      const st = document.createElement('div')
      st.className = 'dialog-status ' + statusCls
      st.textContent = statusIcon
      dlg.appendChild(st)
    }
    dialogsEl.appendChild(dlg)
  })
}

function setBubble(text) {
  if (text == null) {
    bubble.hidden = true
    bubble.textContent = ''
  } else {
    bubble.textContent = text
    bubble.hidden = false
  }
}

// ---------- menu ----------
function showMenu(x, y) {
  const active = state.pets.find((p) => p.dir === state.active)
  menuTitle.textContent = active ? String(active.displayName || active.id) : ''
  menuEl.style.left = x + 'px'
  menuEl.style.top = y + 'px'
  menuEl.hidden = false
  syncMenuLabels()
}
function hideMenu() { menuEl.hidden = true }
function syncMenuLabels() {
  const buttons = menuEl.querySelectorAll('button')
  buttons.forEach((b) => {
    if (b.dataset.act === 'toggle-top') b.textContent = '置顶: ' + (state.config.alwaysOnTop !== false ? '开' : '关')
    if (b.dataset.act === 'toggle-through') b.textContent = '点击穿透: ' + (state.config.clickThrough ? '开' : '关')
  })
}
menuEl.addEventListener('click', (e) => {
  const act = e.target.dataset && e.target.dataset.act
  if (!act) return
  hideMenu()
  const cfg = state.config
  if (act === 'walk') {
    anim.walkDir = Math.random() < 0.5 ? -1 : 1
    anim.walkUntil = Date.now() + 2000 + Math.random() * 2000
  } else if (act === 'pet') {
    setBubble('开心！')
    playSeq([[Math.random() < 0.5 ? 3 : 4, 900]])
    setTimeout(() => { if (anim.queue.length === 0) setBubble(null) }, 1600)
  } else if (act === 'toggle-top') {
    cfg.alwaysOnTop = cfg.alwaysOnTop !== false ? false : true
    saveConfig({ alwaysOnTop: cfg.alwaysOnTop })
  } else if (act === 'toggle-through') {
    cfg.clickThrough = !cfg.clickThrough
    saveConfig({ clickThrough: cfg.clickThrough })
  } else if (act === 'refresh') {
    refreshPets()
  } else if (act === 'quit') {
    window.petHost.quit()
  }
})

// ---------- pet list ----------
async function refreshPets() {
  const pets = await window.petHost.list()
  state.pets = pets || []
  if (!state.active || !state.pets.some((p) => p.dir === state.active)) {
    state.active = (state.config.name && state.pets.some((p) => p.dir === state.config.name)) ? state.config.name : (state.pets[0] ? state.pets[0].dir : null)
  }
  if (state.active) await applyActiveSkin()
}

// ---------- state updates ----------
function applyState(d) {
  if (!d) return
  state.phase = d.phase || 'idle'
  state.phrase = d.phrase || ''
  state.sessions = Array.isArray(d.sessions) ? d.sessions : []

  // auto-undelete dismissed dialogs when a session becomes active again
  const next = {}
  const changed = []
  state.sessions.forEach((ss) => {
    next[ss.id] = ss.phase
    const prev = prevPhases[ss.id]
    if (prev && prev !== ss.phase && isActivePhase(ss.phase)) changed.push(ss.id)
  })
  prevPhases = next
  changed.forEach((id) => { delete dismissed[id] })

  renderDialogs()

  const ph = state.phase
  if (ph === 'starting') { playSeq([[3, 900]]); setBubble('启动中') }
  else if (ph === 'done') { playSeq([[4, 700], [8, 900]]); setBubble('完成'); setTimeout(() => setBubble(null), 2000) }
  else if (ph === 'failed') { playSeq([[5, 1400]]); setBubble('出错了'); setTimeout(() => setBubble(null), 2000) }
  else if (ph === 'waiting') { setBubble(phaseBubbleText(ph, state.phrase)) }
  else if (ph === 'thinking' || ph === 'tool' || ph === 'working') { setBubble(null) }
  else if (ph === 'idle') { setBubble(null) }
}

// ---------- main loop ----------
let lastTick = Date.now()
let lastFrame = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(120, now - lastTick)
  lastTick = now
  const speed = clamp(state.config.animationSpeed || 1, 0.25, 4)
  const animationEnabled = state.config.animationEnabled !== false

  // sleep after 90s idle
  const sleepNow = anim.queue.length === 0 && anim.walkUntil <= now && state.phase === 'idle' && (now - lastEventAt > 90000)
  if (sleepNow && !anim.sleeping) { anim.sleeping = true; setBubble('Zzz…') }
  else if (!sleepNow && anim.sleeping) { anim.sleeping = false; if (state.phase !== 'idle') setBubble(null) }

  let row
  if (drag) {
    row = anim.walkDir >= 0 ? 1 : 2
  } else if (anim.queue.length) {
    if (!anim.queueStart) anim.queueStart = now
    const cur = anim.queue[0]
    if (now - anim.queueStart >= cur.ms / speed) {
      anim.queue.shift()
      anim.queueStart = now
      if (!anim.queue.length) setBubble(null)
    }
    row = anim.queue.length ? anim.queue[0].row : 0
  } else if (anim.walkUntil && now < anim.walkUntil) {
    row = anim.walkDir >= 0 ? 1 : 2
  } else {
    anim.walkUntil = 0
    if (state.phase === 'thinking' || state.phase === 'tool' || state.phase === 'working') row = 7
    else if (state.phase === 'waiting') row = 6
    else row = 0
  }

  if (!animationEnabled) {
    // frozen: show first frame of the chosen row
    if (lastDrawn.row !== row || lastDrawn.frame !== 0) {
      lastDrawn = { row, frame: 0 }
      showFrame(row, 0)
    }
    return
  }

  const eff = (TRACKS[row] && TRACKS[row].ms ? TRACKS[row].ms : 110) / speed
  const ms = anim.sleeping && row === 0 ? eff * 2 : eff
  const len = (frames.rowLen && frames.rowLen[row]) || 8
  if (now - lastFrame >= ms) {
    anim.frame = (anim.frame + 1) % len
    lastFrame = now
  }
  anim.row = row
  if (lastDrawn.row !== row || lastDrawn.frame !== anim.frame) {
    lastDrawn = { row, frame: anim.frame }
    showFrame(row, anim.frame)
  }

  // walking within window, bounce at edges
  if (anim.walkUntil && now < anim.walkUntil && frames.w) {
    let nx = anim.x + anim.walkDir * 0.08 * (state.config.scale || 1) * 30
    if (nx <= 0) { nx = 0; anim.walkDir = 1 }
    if (nx + frames.w >= window.innerWidth) { nx = window.innerWidth - frames.w; anim.walkDir = -1 }
    anim.x = nx
    petImg.style.left = nx + 'px'
  }
}, 30)

// ---------- random idle behavior (randomEnabled / idleFrequencySec) ----------
setInterval(() => {
  if (!state.config.randomEnabled) return
  const now = Date.now()
  if (drag || anim.queue.length || anim.sleeping || state.phase !== 'idle') return
  const r = Math.random()
  if (r < 0.35) {
    anim.walkDir = Math.random() < 0.5 ? -1 : 1
    anim.walkUntil = now + 1800 + Math.random() * 2200
  } else if (r < 0.5) {
    playSeq([[Math.random() < 0.5 ? 3 : 4, 900]])
  }
}, Math.max(8000, (state.config.idleFrequencySec || 15) * 1000))

// ---------- hideWhenIdle: fade the pet out after long idle (desktop keeps window) ----------
let idleHidden = false
const summonEl = (() => {
  const el = document.createElement('div')
  el.className = 'summon'
  el.textContent = '🐾 召唤桌宠'
  el.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);background:rgba(18,20,26,.92);color:#9ecbff;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:8px 14px;font:13px ui-sans-serif,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;display:none;z-index:20;pointer-events:auto;'
  el.addEventListener('click', () => {
    idleHidden = false
    petImg.style.visibility = 'visible'
    el.style.display = 'none'
    lastEventAt = Date.now()
  })
  document.body.appendChild(el)
  return el
})()
setInterval(() => {
  if (!state.config.hideWhenIdle || state.phase !== 'idle') return
  if (Date.now() - lastEventAt > 120000 && !idleHidden) {
    idleHidden = true
    petImg.style.visibility = 'hidden'
    summonEl.style.display = 'block'
  }
}, 5000)

// ---------- interaction ----------
petImg.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state.config.clickThrough) return
  e.preventDefault()
  lastEventAt = Date.now()
  anim.sleeping = false
  drag = { sx: e.screenX, sy: e.screenY, lastX: e.screenX, lastY: e.screenY, moved: false }
  petImg.classList.add('dragging')
  hideMenu()
})

window.addEventListener('mousemove', (e) => {
  if (!drag) return
  const dxTotal = Math.abs(e.screenX - drag.sx)
  const dyTotal = Math.abs(e.screenY - drag.sy)
  if (!drag.moved && (dxTotal > 3 || dyTotal > 3)) {
    drag.moved = true
  }
  if (drag.moved) {
    // send deltas since the last event; main accumulates onto the window position
    const dx = e.screenX - drag.lastX
    const dy = e.screenY - drag.lastY
    drag.lastX = e.screenX
    drag.lastY = e.screenY
    window.petHost.moveBy(dx, dy)
  }
})

window.addEventListener('mouseup', () => {
  if (!drag) return
  const wasDrag = drag.moved
  drag = null
  petImg.classList.remove('dragging')
  if (!wasDrag) {
    // click = interact
    lastEventAt = Date.now()
    const phrases = ['开心！', '嘿嘿～', '害羞…', '傲娇哼！', '摸摸头～']
    setBubble(phrases[Math.floor(Math.random() * phrases.length)])
    playSeq([[Math.random() < 0.5 ? 3 : 4, 900]])
    setTimeout(() => { if (anim.queue.length === 0) setBubble(null) }, 1600)
  }
})

petImg.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  showMenu(e.clientX, e.clientY)
})

petImg.addEventListener('dblclick', () => {
  lastEventAt = Date.now()
  setBubble('嘿嘿～')
  playSeq([[Math.random() < 0.5 ? 3 : 4, 900]])
  setTimeout(() => { if (anim.queue.length === 0) setBubble(null) }, 1500)
})

document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu()
})

// ---------- init ----------
;(async function init() {
  try {
    await loadConfig()
    await refreshPets()
    window.petHost.onState((d) => applyState(d))
    window.petHost.onConfig((c) => applyConfig(c))
    const d = await window.petHost.state()
    applyState(d)
    setInterval(() => {
      window.petHost.state().then(applyState).catch(() => {})
    }, 2000)
  } catch (e) {
    console.error('pet-init: failed', e && e.stack ? e.stack : String(e))
  }
})()
