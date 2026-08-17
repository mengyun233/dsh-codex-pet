/**
 * dsh-codex-pet — host half.
 *
 * Migrates Codex desktop-pet skins into the DSH home and serves the pet data
 * to the browser half over HTTP:
 *   GET  /dsh-pets/api/pets          pet list (migrates on demand)
 *   POST /dsh-pets/api/refresh       force re-scan + migrate
 *   GET  /dsh-pets/api/config        saved pet config
 *   POST /dsh-pets/api/config        persist pet config (JSON body)
 *   POST /dsh-pets/api/stop          cancel an agent (body: {sessionId})
 *   GET  /dsh-pets/api/state         aggregated pet state (polled)
 *   GET  /dsh-pets/<dir>/spritesheet.webp   static sheet
 *
 * The host also listens to agent/tool/approval events and folds them into a
 * per-session state map the browser half renders as animation + dialogs.
 */
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-codex-pet'
export const inject = ['webServer', 'agents', 'sessionTitle']

/** The standalone desktop app ships beside this bundle (desktop/). */
const DESKTOP_DIR = fileURLToPath(new URL('../desktop/', import.meta.url))

/** Resolve the Electron executable if the desktop app's deps are installed. */
function electronExe() {
  const candidates = process.platform === 'win32'
    ? [join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')]
    : [join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron')]
  return candidates.find((p) => existsSync(p)) || null
}

/** Candidate Codex pet roots: CODEX_HOME, LOCALAPPDATA, APPDATA. */
function candidateRoots() {
  const roots = []
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  roots.push(join(codexHome, 'pets'))
  const la = process.env.LOCALAPPDATA
  if (la) roots.push(join(la, 'Codex', 'pets'))
  const aa = process.env.APPDATA
  if (aa) roots.push(join(aa, 'Codex', 'pets'))
  return roots
}

/** Scan every candidate root, copy pet.json + spritesheet.webp into DSH home. */
async function migrateAndScan() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dshPets = join(dshHome, 'pets')
  await mkdir(dshPets, { recursive: true })
  const seen = new Set()
  const pets = []
  for (const root of candidateRoots()) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (seen.has(name)) continue
      const dir = join(root, name)
      const pj = join(dir, 'pet.json')
      const sw = join(dir, 'spritesheet.webp')
      if (!existsSync(pj) || !existsSync(sw)) continue
      let meta = null
      try {
        meta = JSON.parse((await readFile(pj, 'utf8')).replace(/^\uFEFF/, ''))
      } catch { /* keep null */ }
      const id = meta && typeof meta.id === 'string' ? meta.id : name
      const displayName = meta && typeof meta.displayName === 'string' ? meta.displayName : name
      const description = meta && typeof meta.description === 'string' ? meta.description : ''
      const dest = join(dshPets, name)
      await mkdir(dest, { recursive: true })
      await copyFile(pj, join(dest, 'pet.json'))
      await copyFile(sw, join(dest, 'spritesheet.webp'))
      seen.add(name)
      pets.push({ id, dir: name, displayName, description, source: dir })
    }
  }
  return { codexHome: process.env.CODEX_HOME || join(homedir(), '.codex'), dshHome, dshPets, pets }
}

/** Read a JSON request body (max 64 KiB). */
async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Send a JSON response. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(body)
}

export function apply(ctx) {
  const agentState = {
    phase: 'idle',
    phrase: '',
    project: '',
    text: '',
    lastEvent: '',
    at: 0,
    lastFailed: false,
    agentRef: null,
    lastActive: null,
    sessions: new Map()
  }
  let migration = null
  /** Handle of the standalone desktop pet process, if the host launched it. */
  let desktopChild = null

  /** Terminate the desktop pet process tree (Windows: taskkill /T, else child.kill). */
  async function killDesktopPet() {
    const child = desktopChild
    desktopChild = null
    if (!child || typeof child.pid !== 'number') return
    try {
      if (process.platform === 'win32') {
        const { execFile } = await import('node:child_process')
        await new Promise((resolve) => {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve())
        })
      } else {
        child.kill()
      }
    } catch { /* ignore */ }
  }

  function sessionOf(agent) {
    return agent && agent.id ? agent.id : null
  }

  function touchSession(sid) {
    if (!sid) return null
    let e = agentState.sessions.get(sid)
    if (!e) {
      e = { id: sid, phase: 'idle', phrase: '', project: '', text: '', lastFailed: false, at: 0 }
      agentState.sessions.set(sid, e)
    }
    return e
  }

  /** Timers that move a 'starting' session back to idle if it never runs. */
  const startingTimers = new Map()

  function clearStartingTimer(sid) {
    const t = startingTimers.get(sid)
    if (t) { clearTimeout(t); startingTimers.delete(sid) }
  }

  function armStartingTimer(sid) {
    clearStartingTimer(sid)
    const t = setTimeout(() => {
      startingTimers.delete(sid)
      const e = agentState.sessions.get(sid)
      // Only fall back if it's still stuck in 'starting' (never went running).
      if (e && e.phase === 'starting') {
        setSession(sid, 'idle', '')
      }
    }, 15000)
    startingTimers.set(sid, t)
  }

  function setSession(sid, phase, phrase) {
    const e = touchSession(sid)
    if (!e) return
    e.phase = phase
    e.phrase = phrase
    e.at = Date.now()
    agentState.lastActive = sid
    aggregate()
  }

  function aggregate() {
    const PRIO = { failed: 4, thinking: 3, tool: 3, working: 3, starting: 3, waiting: 2, idle: 1 }
    let phase = 'idle'
    let phrase = ''
    let bestAt = -1
    let best = null
    agentState.sessions.forEach((e) => {
      const p = PRIO[e.phase] || 1
      if (p > (PRIO[phase] || 1)) {
        phase = e.phase
        phrase = e.phrase
      }
      if (e.at > bestAt) {
        bestAt = e.at
        best = e
      }
    })
    agentState.phase = phase
    agentState.phrase = phrase
    if (best) agentState.project = best.project
  }

  function noteAgent(agent) {
    if (!agent) return
    agentState.agentRef = agent
    const sid = sessionOf(agent)
    const e = touchSession(sid)
    try {
      const sess = agent.session || null
      if (sess) {
        let title = ''
        const st = ctx.get('sessionTitle')
        if (st) {
          try {
            const snap = st.get(sess)
            if (snap && snap.title) title = String(snap.title)
          } catch { /* ignore */ }
        }
        if (title) {
          if (e) e.project = title
          agentState.project = title
          return
        }
        const cwd = (sess.meta && sess.meta.cwd) || sess.cwd
        if (typeof cwd === 'string' && cwd) {
          const parts = String(cwd).split(/[\\/]+/).filter(Boolean)
          const base = parts[parts.length - 1] || cwd
          if (e) e.project = base
          agentState.project = base
        }
      }
    } catch { /* ignore */ }
  }

  ctx.effect(() => {
    const disposers = []

    disposers.push(ctx.on('agent/session-start', (payload) => {
      noteAgent(payload && payload.agent)
      const sid = sessionOf(payload && payload.agent)
      setSession(sid, 'starting', '启动中')
      armStartingTimer(sid)
      agentState.lastEvent = 'agent/session-start'
    }))
    disposers.push(ctx.on('agent/status', (payload) => {
      noteAgent(payload && payload.agent)
      const sid = sessionOf(payload && payload.agent)
      const st = payload && payload.status
      const e = touchSession(sid)
      if (st === 'running') {
        clearStartingTimer(sid)
        setSession(sid, 'thinking', '思考中')
      } else if (st === 'idle') {
        clearStartingTimer(sid)
        setSession(sid, (e && e.lastFailed) ? 'failed' : 'done', (e && e.lastFailed) ? '出错了' : '完成')
        if (e) e.lastFailed = false
      }
      agentState.lastEvent = 'agent/status:' + st
      agentState.at = Date.now()
    }))
    disposers.push(ctx.on('tools/pre-execute', (exec, next) => {
      return Promise.resolve(next()).then((gate) => {
        if (gate && gate.kind === 'ask') {
          setSession((exec && exec.agent) ? sessionOf(exec.agent) : agentState.lastActive, 'waiting', '等待用户批准')
          agentState.lastEvent = 'tools/pre-execute:ask'
        }
        return gate
      })
    }))
    disposers.push(ctx.on('tools/execute', (exec, next) => {
      const tname = exec && exec.name
      const sid = (exec && exec.agent) ? sessionOf(exec.agent) : agentState.lastActive
      const e = touchSession(sid)
      if (tname === 'ask_user_question') {
        setSession(sid, 'waiting', '等待用户输入')
      } else if (!e || e.phase !== 'waiting') {
        setSession(sid, 'tool', tname ? ('正在使用 ' + tname) : '正在使用工具')
      }
      agentState.lastEvent = 'tools/execute:' + (tname || '?')
      agentState.at = Date.now()
      return next()
    }))
    disposers.push(ctx.on('tools/result', (exec, result) => {
      const tname = exec && exec.name
      const sid = (exec && exec.agent) ? sessionOf(exec.agent) : agentState.lastActive
      const e = touchSession(sid)
      // A failed tool result (e.g. tool call aborted / error) is a failure for
      // this session even though the agent loop ends "idle" — remember it so the
      // pet shows the red "!" instead of a green check.
      if (result && result.isError) {
        if (e) e.lastFailed = true
      }
      if (e && e.phase === 'waiting') {
        setSession(sid, 'thinking', '思考中')
      }
      agentState.lastEvent = 'tools/result:' + (tname || '?') + (result && result.isError ? ':error' : '')
      agentState.at = Date.now()
    }))
    disposers.push(ctx.on('internal/dispatch', (mode, eventName, args) => {
      if (eventName === 'approval/request') {
        const req = args && args[0]
        setSession((req && req.agent) ? sessionOf(req.agent) : agentState.lastActive, 'waiting', '等待用户批准')
        agentState.lastEvent = 'approval/request(dispatch)'
      }
    }, { global: true }))
    disposers.push(ctx.on('approval/request', (req, next) => {
      const sid = req && req.agent ? sessionOf(req.agent) : agentState.lastActive
      setSession(sid, 'waiting', '等待用户批准')
      agentState.lastEvent = 'approval/request'
      return next().then((outcome) => {
        const e = touchSession(sid)
        if (e && e.phase === 'waiting') {
          setSession(sid, 'thinking', '思考中')
        }
        return outcome
      })
    }))
    disposers.push(ctx.on('agent/error', (payload) => {
      const sid = sessionOf(payload && payload.agent) || agentState.lastActive
      const e = touchSession(sid)
      if (e) e.lastFailed = true
      setSession(sid, 'failed', '出错了')
      agentState.lastEvent = 'agent/error'
      agentState.at = Date.now()
    }))
    disposers.push(ctx.on('workflow/phase', (info, title) => {
      if (title) {
        setSession(agentState.lastActive, 'working', String(title))
        agentState.lastEvent = 'workflow/phase'
        agentState.at = Date.now()
      }
    }))
    disposers.push(ctx.on('llm/stream', (options, next) => {
      const stream = next()
      // Only enrich the currently-last-active session's text; never force its
      // phase (that belongs to agent/status), so a stream from another session
      // cannot mark an unrelated session as "thinking" (the stale-starting bug).
      const sid = agentState.lastActive
      return (async function* () {
        const e = touchSession(sid)
        if (e) e.text = ''
        agentState.lastEvent = 'llm/stream'
        agentState.at = Date.now()
        try {
          for await (const chunk of stream) {
            if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
              const cur = touchSession(sid)
              if (cur) {
                const t = (cur.text || '') + chunk.text
                cur.text = t.length > 150 ? t.slice(-150) : t
              }
            }
            yield chunk
          }
        } catch (err) {
          throw err
        }
      })()
    }))

    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-pets',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://x')
          const pathname = url.pathname
          const method = req.method || 'GET'

          if (pathname === '/dsh-pets/api/pets' && method === 'GET') {
            if (!migration) migration = migrateAndScan()
            const data = await migration
            return sendJson(res, 200, { ...data, rev: Date.now() })
          }
          if (pathname === '/dsh-pets/api/refresh' && method === 'POST') {
            migration = migrateAndScan()
            const data = await migration
            return sendJson(res, 200, { ...data, rev: Date.now() })
          }
          if (pathname === '/dsh-pets/api/config' && method === 'GET') {
            const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
            let cfg = {}
            try {
              const text = await readFile(join(dshHome, 'pet.json'), 'utf8')
              const data = JSON.parse(text)
              if (data && data.codexPet) cfg = data.codexPet
            } catch { /* keep {} */ }
            return sendJson(res, 200, cfg)
          }
          if (pathname === '/dsh-pets/api/config' && method === 'POST') {
            const body = await readBody(req)
            const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
            let whole = {}
            try {
              whole = JSON.parse(await readFile(join(dshHome, 'pet.json'), 'utf8'))
            } catch { /* keep {} */ }
            whole.codexPet = body || {}
            await writeFile(join(dshHome, 'pet.json'), JSON.stringify(whole, null, 2), 'utf8')
            return sendJson(res, 200, { ok: true })
          }
          if (pathname === '/dsh-pets/api/stop' && method === 'POST') {
            const body = await readBody(req)
            const sid = body && body.sessionId
            const agents = ctx.get('agents')
            const agent = (sid && agents && agents.get(sid)) || agentState.agentRef
            if (!agent) return sendJson(res, 200, { ok: false, reason: 'no-agent' })
            try {
              agent.cancel({ kind: 'user' })
              return sendJson(res, 200, { ok: true })
            } catch (e) {
              return sendJson(res, 200, { ok: false, error: String((e && e.message) || e) })
            }
          }
          if (pathname === '/dsh-pets/api/state' && method === 'GET') {
            noteAgent(agentState.agentRef)
            aggregate()
            const sessions = []
            agentState.sessions.forEach((e) => {
              sessions.push({ id: e.id, phase: e.phase, phrase: e.phrase, project: e.project, text: e.text, at: e.at })
            })
            return sendJson(res, 200, {
              phase: agentState.phase,
              phrase: agentState.phrase,
              project: agentState.project,
              text: agentState.text,
              lastEvent: agentState.lastEvent,
              sessions,
              at: agentState.at
            })
          }
          if (pathname === '/dsh-pets/api/mode' && method === 'GET') {
            const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
            let mode = 'web'
            try {
              const data = JSON.parse(await readFile(join(dshHome, 'pet.json'), 'utf8'))
              if (data && data.codexPet && typeof data.codexPet.mode === 'string') mode = data.codexPet.mode
            } catch { /* keep web */ }
            return sendJson(res, 200, {
              mode,
              desktopReady: electronExe() !== null,
              desktopDir: DESKTOP_DIR
            })
          }
          if (pathname === '/dsh-pets/api/mode' && method === 'POST') {
            const body = await readBody(req)
            const nextMode = body && body.mode === 'desktop' ? 'desktop' : 'web'
            const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
            let whole = {}
            try {
              whole = JSON.parse(await readFile(join(dshHome, 'pet.json'), 'utf8'))
            } catch { /* keep {} */ }
            if (!whole.codexPet || typeof whole.codexPet !== 'object') whole.codexPet = {}
            whole.codexPet.mode = nextMode
            await writeFile(join(dshHome, 'pet.json'), JSON.stringify(whole, null, 2), 'utf8')
            if (nextMode === 'desktop') {
              const exe = electronExe()
              if (!exe) return sendJson(res, 200, { ok: false, reason: 'electron-missing', desktopDir: DESKTOP_DIR })
              try {
                const child = spawn(exe, ['.'], { cwd: DESKTOP_DIR, detached: true, stdio: 'ignore', windowsHide: true })
                desktopChild = child
                child.on('exit', () => { if (desktopChild === child) desktopChild = null })
                child.unref()
                return sendJson(res, 200, { ok: true, mode: nextMode })
              } catch (e) {
                return sendJson(res, 200, { ok: false, error: String((e && e.message) || e) })
              }
            }
            // Switching back to web: stop the standalone desktop pet.
            await killDesktopPet()
            return sendJson(res, 200, { ok: true, mode: nextMode })
          }

          // Static spritesheet: /dsh-pets/<dir>/spritesheet.webp
          const parts = pathname.split('/').filter(Boolean)
          if (parts.length === 3 && parts[0] === 'dsh-pets' && parts[2] === 'spritesheet.webp') {
            let dir = ''
            try { dir = decodeURIComponent(parts[1]) } catch { dir = '' }
            if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
              res.writeHead(404, { 'content-type': 'text/plain' })
              return res.end('unknown pet')
            }
            if (!migration) migration = migrateAndScan()
            const data = await migration
            if (!data.pets.some((p) => p.dir === dir)) {
              res.writeHead(404, { 'content-type': 'text/plain' })
              return res.end('unknown pet')
            }
            const bytes = await readFile(join(data.dshPets, dir, 'spritesheet.webp'))
            res.writeHead(200, {
              'content-type': 'image/webp',
              'content-length': bytes.byteLength,
              'cache-control': 'public, max-age=31536000, immutable'
            })
            return res.end(bytes)
          }

          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('not found')
        } catch (err) {
          try {
            sendJson(res, 500, { error: String((err && err.message) || err) })
          } catch { /* ignore */ }
        }
      }
    }), 'dsh-codex-pet: routes')

    // Warm the migration so the first browser poll is fast.
    migration = migrateAndScan().catch((e) => {
      console.error('dsh-codex-pet initial migration failed:', (e && e.message) || e)
    })

    return () => {
      for (const d of disposers) {
        if (typeof d === 'function') d()
      }
    }
  }, 'dsh-codex-pet: host')
}
