window.__ModuleLoader__.load({
	id: "dsh-codex-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region styles
		const css = ".dsh-cp-pet-wrap{position:fixed;pointer-events:none;z-index:2147483000;}"
			+ ".dsh-cp-pet{pointer-events:auto;cursor:grab;user-select:none;touch-action:none;image-rendering:pixelated;}"
			+ ".dsh-cp-pet.dragging{cursor:grabbing;}"
			+ ".dsh-cp-through .dsh-cp-pet{pointer-events:none;}"
			+ ".dsh-cp-dialog{position:fixed;pointer-events:auto;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#1f2328;border:1px solid rgba(0,0,0,.08);border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.22);padding:6px 12px;width:240px;z-index:2147483002;display:flex;align-items:center;gap:10px;font:12px/1.45 ui-sans-serif,system-ui,sans-serif;text-align:left;cursor:pointer;box-sizing:border-box;}"
			+ ".dsh-cp-dialog.collapsed{padding:5px 12px;cursor:pointer;}"
			+ ".dsh-cp-dialog-body{flex:1;min-width:0;}"
			+ ".dsh-cp-dialog-project{font-weight:700;font-size:12.5px;color:#1f2328;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
			+ ".dsh-cp-dialog-doing{color:#6b7280;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}"
			+ ".dsh-cp-dialog-status{flex:none;font-size:16px;font-weight:800;line-height:1;}"
			+ ".dsh-cp-dialog-status.ok{color:#16a34a;}"
			+ ".dsh-cp-dialog-status.err{color:#dc2626;}"
			+ ".dsh-cp-dialog-stop{flex:none;width:24px;height:24px;border-radius:50%;border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.1);color:#dc2626;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;}"
			+ ".dsh-cp-dialog-stop:hover{background:rgba(220,38,38,.28);}"
			+ ".dsh-cp-summon{position:fixed;right:18px;bottom:14px;z-index:2147483000;pointer-events:auto;cursor:pointer;background:rgba(18,20,26,.92);color:#9ecbff;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:8px 14px;font:13px ui-sans-serif,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);}"
			+ ".dsh-cp-summon:hover{background:rgba(40,44,56,.95);}"
			+ ".dsh-cp-menu{position:fixed;z-index:2147483001;background:rgba(18,20,26,.95);color:#e9eaee;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:6px;font:12px/1.5 ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4);pointer-events:auto;min-width:172px;}"
			+ ".dsh-cp-menu .dsh-cp-title{padding:4px 10px;font-weight:600;color:#9ecbff;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
			+ ".dsh-cp-menu button{display:block;width:100%;text-align:left;background:none;border:none;color:inherit;padding:6px 10px;border-radius:6px;cursor:pointer;font:inherit;}"
			+ ".dsh-cp-menu button:hover{background:rgba(255,255,255,.1);}"
			+ ".dsh-cp-panel{font:13px/1.6 ui-sans-serif,system-ui,sans-serif;padding:4px 2px;}"
			+ ".dsh-cp-panel .dsh-cp-title{font-weight:600;margin-bottom:6px;}"
			+ ".dsh-cp-panel .row{margin:6px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}"
			+ ".dsh-cp-panel button{background:rgba(127,127,127,.16);border:1px solid rgba(127,127,127,.3);color:inherit;border-radius:8px;padding:5px 12px;cursor:pointer;font:inherit;}"
			+ ".dsh-cp-panel button:hover{background:rgba(127,127,127,.28);}"
			+ ".dsh-cp-panel .pets{display:flex;flex-direction:column;gap:4px;margin:6px 0;}"
			+ ".dsh-cp-panel .pets label{cursor:pointer;}"
			+ ".dsh-cp-panel .desc{opacity:.6;margin-left:2px;}"
			+ ".dsh-cp-panel .muted{opacity:.55;font-size:12px;}";
		const tagId = "dsh-codex-pet/css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-codex-pet";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const el = react.createElement;

		//#region helpers
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

		/** HTTP RPC to the host half (replaces the dynamic runner's host.call). */
		async function rpc(path, body) {
			const res = await fetch('/dsh-pets/api/' + path, body === undefined ? {} : {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
			if (!res.ok) throw new Error('HTTP ' + res.status)
			return res.json()
		}
		const rpcGet = (path) => rpc(path)

		//#endregion

		//#region store
		const store = {
			pets: [],
			active: null,
			visible: true,
			scale: 1.0,
			rev: 0,
			randomEnabled: true,
			animationEnabled: true,
			animationSpeed: 1.0,
			idleFrequencySec: 15,
			alwaysOnTop: true,
			clickThrough: false,
			hideWhenIdle: false,
			mode: 'web',
			desktopReady: false,
			phase: 'idle',
			phrase: '',
			project: '',
			sessions: [],
			lastEvent: '',
			bubble: null,
			codexHome: '',
			dshPets: '',
			busy: false,
			error: '',
			mounts: 0,
			canvasOk: true,
			covered: false,
			hiddenByStyle: false,
			drawAgeMs: null,
			listeners: new Set(),
			get() {
				return {
					pets: this.pets, active: this.active, visible: this.visible, scale: this.scale, rev: this.rev,
					randomEnabled: this.randomEnabled, animationEnabled: this.animationEnabled,
					animationSpeed: this.animationSpeed, idleFrequencySec: this.idleFrequencySec,
					alwaysOnTop: this.alwaysOnTop, clickThrough: this.clickThrough, hideWhenIdle: this.hideWhenIdle,
					mode: this.mode, desktopReady: this.desktopReady,
					phase: this.phase, phrase: this.phrase, project: this.project, sessions: this.sessions,
					lastEvent: this.lastEvent, bubble: this.bubble, codexHome: this.codexHome, dshPets: this.dshPets,
					busy: this.busy, error: this.error, mounts: this.mounts, canvasOk: this.canvasOk,
					covered: this.covered, hiddenByStyle: this.hiddenByStyle, drawAgeMs: this.drawAgeMs
				}
			},
			set(patch) {
				for (const k in patch) this[k] = patch[k]
				this.listeners.forEach((l) => l())
			},
			subscribe(l) {
				this.listeners.add(l)
				return () => { this.listeners.delete(l) }
			}
		}
		//#endregion

		//#region frames
		const framesCache = new Map()
		const FRAMES_CACHE_MAX = 8
		const loadedRef = { current: false }
		const persistRef = {
			x: 0, y: 0,
			winW: (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200,
			winH: (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
		}

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

		function useStore() {
			const [, force] = react.useState(0)
			react.useEffect(() => store.subscribe(() => force((x) => x + 1)), [])
			return store.get()
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

		function playSeq(a, rows) {
			a.queue = rows.map((r) => ({ row: r[0], ms: r[1] }))
			a.queueStart = 0
		}

		function currentConfig() {
			return {
				name: store.active,
				x: Math.round(persistRef.x), y: Math.round(persistRef.y),
				winW: persistRef.winW, winH: persistRef.winH,
				scale: store.scale,
				alwaysOnTop: store.alwaysOnTop,
				clickThrough: store.clickThrough,
				hideWhenIdle: store.hideWhenIdle,
				animationEnabled: store.animationEnabled,
				animationSpeed: store.animationSpeed,
				idleFrequencySec: store.idleFrequencySec
			}
		}
		//#endregion

		function PetOverlay(props) {
			const timer = props.timer
			const sessionsSvc = props.sessionsSvc
			const s = useStore()
			const save = react.useMemo(() => saveConfig(timer), [timer])
			const [frames, setFrames] = react.useState(null)
			const [pos, setPos] = react.useState(null)
			const [menu, setMenu] = react.useState(null)
			const [dragging, setDragging] = react.useState(false)
			const [facing, setFacing] = react.useState(1)
			const [hoverId, setHoverId] = react.useState(null)
			const [collapsed, setCollapsed] = react.useState({})
			const [dismissed, setDismissed] = react.useState({})
			const clickTimers = react.useRef({})
			const prevPhases = react.useRef({})
			const imgRef = react.useRef(null)
			const posRef = react.useRef({ x: 0, y: 0 })
			const dragRef = react.useRef(null)
			const lastDrawnRef = react.useRef({ row: -1, frame: -1 })
			const lastDrawAtRef = react.useRef(0)
			const lastEventAtRef = react.useRef(Date.now())
			const prevPhaseRef = react.useRef(null)
			const animRef = react.useRef({ row: 0, frame: 0, dragging: false, dragDir: 1, queue: [], queueStart: 0, sleeping: false, walkUntil: 0, walkDir: 1, lookRow: 9, lookFrame: 0, lookUntil: 0 })
			const framesRef = react.useRef(null)
			if (frames) framesRef.current = frames

			const active = s.pets.find((p) => p.dir === s.active) || null

			react.useEffect(() => {
				store.set({ mounts: store.mounts + 1 })
			}, [])

			react.useEffect(() => {
				const next = {}
				const changed = []
				;(s.sessions || []).forEach((ss) => {
					next[ss.id] = ss.phase
					const prev = prevPhases.current[ss.id]
					if (prev && prev !== ss.phase && isActivePhase(ss.phase)) changed.push(ss.id)
				})
				prevPhases.current = next
				if (changed.length) {
					setDismissed((prev) => {
						const d = Object.assign({}, prev)
						let any = false
						changed.forEach((id) => { if (d[id]) { delete d[id]; any = true } })
						return any ? d : prev
					})
				}
			}, [s.sessions])

			function showFrame(row, frame) {
				const im = imgRef.current
				const fr = framesRef.current
				if (!im || !fr) return
				const idx = row * fr.cols + frame
				const src = fr.list[idx]
				if (!src) return
				if (im.src !== src) im.src = src
				im.style.marginTop = (fr.maxGap - fr.gaps[idx]) + 'px'
				lastDrawAtRef.current = Date.now()
			}

			react.useEffect(() => {
				if (!active) { setFrames(null); return }
				let alive = true
				const cacheKey = active.dir + '@' + s.rev + '@' + s.scale
				const hit = framesCache.get(cacheKey)
				const applyFrames = (fr) => {
					framesRef.current = fr
					setFrames(fr)
					const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
					const winH = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
					let x, y
					if (loadedRef.current && persistRef.x !== 0 && persistRef.y !== 0) {
						x = persistRef.x
						y = persistRef.y
					} else {
						x = Math.max(4, Math.min(winW - fr.w - 8, (winW - fr.w) / 2))
						y = Math.max(4, winH - fr.h - fr.maxGap - 110)
					}
					posRef.current = { x, y }
					persistRef.x = x
					persistRef.y = y
					setPos({ x, y })
					lastDrawnRef.current = { row: -1, frame: -1 }
					const a = animRef.current
					a.row = 0; a.frame = 0; a.queue = []; a.queueStart = 0; a.sleeping = false; a.walkUntil = 0
				}
				if (hit) {
					applyFrames(hit)
					return () => { alive = false }
				}
				const url = '/dsh-pets/' + encodeURIComponent(active.dir) + '/spritesheet.webp?v=' + s.rev
				const img = new Image()
				img.onload = () => {
					if (!alive) return
					const g = deriveGrid(img.naturalWidth, img.naturalHeight)
					const fr = buildFrames(img, g, s.scale)
					if (framesCache.size >= FRAMES_CACHE_MAX) {
						const first = framesCache.keys().next().value
						framesCache.delete(first)
					}
					framesCache.set(cacheKey, fr)
					applyFrames(fr)
				}
				img.src = url
				return () => { alive = false }
			}, [active ? active.dir : null, s.rev, s.scale])

			react.useEffect(() => {
				const im = imgRef.current
				if (!im || !frames) return
				const a = animRef.current
				lastDrawnRef.current = { row: -1, frame: -1 }
				showFrame(a.row, a.frame)
			}, [frames])

			react.useEffect(() => {
				const ph = s.phase
				if (prevPhaseRef.current === ph) return
				prevPhaseRef.current = ph
				const a = animRef.current
				a.sleeping = false
				lastEventAtRef.current = Date.now()
				if (store.bubble === 'Zzz…') store.set({ bubble: null })
				if (ph === 'starting') { playSeq(a, [[3, 900]]); store.set({ bubble: '启动中' }) }
				else if (ph === 'done') { playSeq(a, [[4, 700], [8, 900]]); store.set({ bubble: '完成' }) }
				else if (ph === 'failed') { playSeq(a, [[5, 1400]]); store.set({ bubble: '出错了' }) }
				else if (ph === 'waiting') { store.set({ bubble: phaseBubbleText(ph, s.phrase) }) }
				else if (ph === 'thinking' || ph === 'tool' || ph === 'working') { store.set({ bubble: null }) }
				else if (ph === 'idle') { store.set({ bubble: null }) }
				else if (ph === 'sleeping') { store.set({ bubble: 'Zzz…' }) }
			}, [s.phase])

			react.useEffect(() => {
				if (!frames) return
				if (!s.animationEnabled) return
				let lastFrame = Date.now()
				let lastTick = Date.now()
				return timer.interval(() => {
					const a = animRef.current
					const now = Date.now()
					const dt = Math.min(120, now - lastTick)
					lastTick = now
					const speed = clamp(s.animationSpeed, 0.25, 4)

					const sleepNow = !a.dragging && a.queue.length === 0 && a.walkUntil <= now
						&& s.phase === 'idle'
						&& (now - lastEventAtRef.current > 90000)
					if (sleepNow && !a.sleeping) {
						a.sleeping = true
						store.set({ bubble: 'Zzz…' })
					} else if (!sleepNow && a.sleeping) {
						a.sleeping = false
						if (store.bubble === 'Zzz…') store.set({ bubble: null })
					}

					let row
					if (a.dragging) {
						row = a.dragDir >= 0 ? 1 : 2
					} else if (a.queue.length) {
						if (!a.queueStart) a.queueStart = now
						const cur = a.queue[0]
						if (now - a.queueStart >= cur.ms / speed) {
							a.queue.shift()
							a.queueStart = now
							if (!a.queue.length) store.set({ bubble: null })
						}
						row = a.queue.length ? a.queue[0].row : 0
					} else if (a.walkUntil && now < a.walkUntil) {
						row = a.walkDir >= 0 ? 1 : 2
					} else {
						a.walkUntil = 0
						if (s.phase === 'thinking' || s.phase === 'tool' || s.phase === 'working') row = 7
						else if (s.phase === 'waiting') row = 6
						else row = 0
					}

					const eff = (TRACKS[row] && TRACKS[row].ms ? TRACKS[row].ms : 110) / speed
					const ms = a.sleeping && row === 0 ? eff * 2 : eff
					const len = (frames.rowLen && frames.rowLen[row]) || 8
					if (now - lastFrame >= ms) {
						a.frame = (a.frame + 1) % len
						lastFrame = now
					}
					a.row = row
					if (lastDrawnRef.current.row !== row || lastDrawnRef.current.frame !== a.frame) {
						lastDrawnRef.current = { row, frame: a.frame }
						showFrame(row, a.frame)
					}
				}, 30)
			}, [frames, s.scale, s.animationEnabled, s.animationSpeed, s.phase])

			react.useEffect(() => {
				if (!frames || !s.randomEnabled) return
				const period = Math.max(8000, (s.idleFrequencySec || 15) * 1000)
				return timer.interval(() => {
					const a = animRef.current
					const now = Date.now()
					if (a.dragging || a.queue.length || a.sleeping || s.phase !== 'idle') return
					const r = Math.random()
					if (r < 0.35) {
						a.walkDir = Math.random() < 0.5 ? -1 : 1
						a.walkUntil = now + 1800 + Math.random() * 2200
					} else if (r < 0.5) {
						playSeq(a, [[Math.random() < 0.5 ? 3 : 4, 900]])
					}
				}, period)
			}, [frames, s.randomEnabled, s.idleFrequencySec, s.phase])

			react.useEffect(() => {
				if (!frames) return
				return timer.interval(() => {
					const a = animRef.current
					const now = Date.now()
					if (a.dragging || a.queue.length || !a.walkUntil) return
					if (now >= a.walkUntil) { a.walkUntil = 0; return }
					const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
					const w = frames.w
					let nx = posRef.current.x + a.walkDir * 0.08 * s.scale * 30
					if (nx <= 0) { nx = 0; a.walkDir = 1 }
					if (nx + w >= winW) { nx = winW - w; a.walkDir = -1 }
					if (Math.round(nx) !== Math.round(posRef.current.x)) {
						posRef.current.x = nx
						persistRef.x = nx
						setPos({ x: nx, y: posRef.current.y })
					}
				}, 60)
			}, [frames, s.scale])

			react.useEffect(() => {
				if (typeof window === 'undefined') return
				const onMove = (e) => {
					const a = animRef.current
					const now = Date.now()
					if (a.dragging && dragRef.current && frames) {
						const w = frames.w
						const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
						const winH = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
						const nx = Math.max(-w * 0.6, Math.min(winW - w * 0.4, e.clientX - dragRef.current.sx))
						const ny = Math.max(0, Math.min(winH - 30, e.clientY - dragRef.current.sy))
						a.dragDir = (nx - posRef.current.x) >= 0 ? 1 : -1
						posRef.current = { x: nx, y: ny }
						persistRef.x = nx
						persistRef.y = ny
						setPos({ x: nx, y: ny })
						return
					}
					if (dragRef.current && frames && !a.dragging) {
						const dx = Math.abs(e.clientX - dragRef.current.sx)
						const dy = Math.abs(e.clientY - dragRef.current.sy)
						if (dx > 4 || dy > 4) {
							a.dragging = true
							dragRef.current.moved = true
							setDragging(true)
						}
					}
					if (a.dragging || !frames) return
					if (frames.rows >= 11) {
						const cx = posRef.current.x + frames.w / 2
						const dx = e.clientX - cx
						const winW = (typeof window !== 'undefined' ? window.innerWidth : 1) || 1
						const t = clamp(Math.abs(dx) / (winW * 0.5), 0, 1)
						const f = Math.min(7, Math.floor(t * 8))
						a.lookRow = dx >= 0 ? 10 : 9
						a.lookFrame = f
						a.lookUntil = now + 1600
					} else {
						const cx = posRef.current.x + frames.w / 2
						setFacing(e.clientX >= cx ? 1 : -1)
					}
				}
				const onUp = () => {
					const a = animRef.current
					const wasDown = !!dragRef.current
					const wasDrag = a.dragging
					const wasMoved = !!(dragRef.current && dragRef.current.moved)
					if (a.dragging) {
						a.dragging = false
						setDragging(false)
						save()
					}
					dragRef.current = null
					if (wasDown && !wasDrag && !wasMoved) {
						lastEventAtRef.current = Date.now()
						const now = Date.now()
						const phrases = ['开心！', '嘿嘿～', '害羞…', '傲娇哼！', '摸摸头～']
						store.set({ bubble: phrases[Math.floor(Math.random() * phrases.length)] })
						playSeq(a, [[Math.random() < 0.5 ? 3 : 4, 900]])
						timer.timeout(() => {
							if (a.queue.length === 0) store.set({ bubble: null })
						}, 1600)
					}
				}
				const onKey = (e) => {
					if (e.key === 'Escape') {
						store.set({ visible: false })
						setMenu(null)
					}
				}
				const onResize = () => {
					const ww = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
					const wh = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
					const oldW = persistRef.winW || ww
					const oldH = persistRef.winH || wh
					if (oldW > 0 && oldH > 0 && posRef.current) {
						const nx = posRef.current.x / oldW * ww
						const ny = posRef.current.y / oldH * wh
						posRef.current = { x: nx, y: ny }
						persistRef.x = nx
						persistRef.y = ny
						setPos({ x: nx, y: ny })
					}
					persistRef.winW = ww
					persistRef.winH = wh
					save()
				}
				window.addEventListener('mousemove', onMove)
				window.addEventListener('mouseup', onUp)
				window.addEventListener('keydown', onKey)
				window.addEventListener('resize', onResize)
				return () => {
					window.removeEventListener('mousemove', onMove)
					window.removeEventListener('mouseup', onUp)
					window.removeEventListener('keydown', onKey)
					window.removeEventListener('resize', onResize)
				}
			}, [frames, s.scale])

			react.useEffect(() => {
				if (!frames) return
				return timer.interval(() => {
					const im = imgRef.current
					const ok = !!(im && im.isConnected)
					let covered = false
					let hiddenByStyle = false
					if (ok && typeof document !== 'undefined') {
						const r = im.getBoundingClientRect()
						if (r.width > 0 && r.height > 0) {
							const cx = r.left + r.width / 2
							const cy = r.top + r.height / 2
							try {
								const top = document.elementFromPoint(cx, cy)
								covered = !(top === im || (top && im.contains(top)))
							} catch (e) { /* ignore */ }
						}
						try {
							let elc = im
							while (elc && elc.nodeType === 1) {
								const cs = getComputedStyle(elc)
								if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
									hiddenByStyle = true
									break
								}
								elc = elc.parentElement
							}
						} catch (e) { /* ignore */ }
					}
					store.set({
						canvasOk: ok,
						covered,
						hiddenByStyle,
						drawAgeMs: lastDrawAtRef.current ? (Date.now() - lastDrawAtRef.current) : null
					})
				}, 1000)
			}, [frames])

			react.useEffect(() => {
				if (!s.hideWhenIdle || s.phase !== 'idle' || !s.visible) return
				return timer.interval(() => {
					if (store.phase === 'idle' && Date.now() - lastEventAtRef.current > 120000) {
						store.set({ visible: false })
					}
				}, 5000)
			}, [s.hideWhenIdle, s.phase, s.visible])

			// In desktop mode the standalone Electron window owns the pet;
			// the in-page overlay stays fully hidden.
			if (s.mode === 'desktop') return null
			if (!s.visible) {
				return el('div', { className: 'dsh-cp-summon', onClick: () => store.set({ visible: true }) }, '🐾 召唤桌宠')
			}
			if (!active || !frames || !pos) return null

			const wrapZ = s.alwaysOnTop ? 2147483000 : 1000000
			const flip = (FLIP_ROWS[animRef.current.row] && facing < 0) ? 'scaleX(-1)' : 'none'
			const wrapH = frames.h + frames.maxGap
			const petBottomY = Math.round(pos.y) + wrapH
			const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
			const winH = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
			const dialogLeft = clamp(Math.round(pos.x) + Math.round(frames.w / 2), 160, winW - 160)

			const sorted = (s.sessions || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0))
			const shown = sorted.filter((ss) => ss.phase !== 'idle' && !dismissed[ss.id]).slice(0, 5)

			const onStop = (sid) => {
				rpc('stop', sid ? { sessionId: sid } : {}).then((r) => {
					store.set({ bubble: (r && r.ok) ? '已停止' : '无法停止' })
				}).catch(() => {
					store.set({ bubble: '停止失败' })
				})
				timer.timeout(() => { store.set({ bubble: null }) }, 1500)
			}

			const dialogEls = shown.map((ss, idx) => {
				const isCollapsed = !!collapsed[ss.id]
				const canStop = isActivePhase(ss.phase)
				const hovered = hoverId === ss.id
				const statusCls = ss.phase === 'done' ? 'ok' : ss.phase === 'failed' ? 'err' : ''
				const statusIcon = ss.phase === 'done' ? '✓' : ss.phase === 'failed' ? '!' : null
				const activeTxt = isActivePhase(ss.phase)
				const activity = isCollapsed ? '' : (activeTxt && ss.text ? ss.text : (phaseBubbleText(ss.phase, ss.phrase) || '正在待机'))
				const rowH = isCollapsed ? 24 : 46
				const top = Math.max(4, petBottomY + 8 - idx * (rowH + 6))
				return el('div', {
					key: ss.id,
					className: 'dsh-cp-dialog' + (isCollapsed ? ' collapsed' : ''),
					style: { left: dialogLeft, top: Math.min(top, winH - rowH), transform: 'translateX(-50%)' },
					onMouseEnter: () => setHoverId(ss.id),
					onMouseLeave: () => setHoverId(null),
					onClick: () => {
						const t = clickTimers.current[ss.id]
						if (t) {
							t()
							delete clickTimers.current[ss.id]
							return
						}
						clickTimers.current[ss.id] = timer.timeout(() => {
							delete clickTimers.current[ss.id]
							setCollapsed((prev) => {
								const next = Object.assign({}, prev)
								next[ss.id] = !next[ss.id]
								return next
							})
						}, 220)
					},
					onDoubleClick: () => {
						const t = clickTimers.current[ss.id]
						if (t) { t(); delete clickTimers.current[ss.id] }
						setDismissed((prev) => {
							const next = Object.assign({}, prev)
							next[ss.id] = true
							return next
						})
						if (sessionsSvc && ss.id) {
							try { sessionsSvc.open(ss.id) } catch (e) { /* ignore */ }
						}
					}
				},
					el('div', { className: 'dsh-cp-dialog-body' },
						el('div', { className: 'dsh-cp-dialog-project' }, ss.project || 'DSH'),
						!isCollapsed ? el('div', { className: 'dsh-cp-dialog-doing' }, activity) : null
					),
					hovered && canStop
						? el('button', { className: 'dsh-cp-dialog-stop', title: '终止对话', onClick: (e) => { e.stopPropagation(); onStop(ss.id) } }, '⏹')
						: (statusIcon ? el('div', { className: 'dsh-cp-dialog-status ' + statusCls }, statusIcon) : null)
				)
			})

			const menuActions = [
				{ label: '随机散步', run: () => {
					const a = animRef.current
					a.walkDir = Math.random() < 0.5 ? -1 : 1
					a.walkUntil = Date.now() + 2000 + Math.random() * 2000
					setMenu(null)
				} },
				{ label: '隐藏桌宠', run: () => { store.set({ visible: false }); setMenu(null) } },
				{ label: '重新扫描 Codex 皮肤', run: () => {
					setMenu(null)
					store.set({ busy: true, error: '' })
					rpc('refresh').then((data) => {
						const pets = Array.isArray(data.pets) ? data.pets : []
						const active = pets.some((p) => p.dir === store.active) ? store.active : (pets[0] ? pets[0].dir : null)
						store.set({ pets, codexHome: data.codexHome || '', dshPets: data.dshPets || '', rev: data.rev || 0, active, busy: false })
					}).catch((e) => {
						store.set({ busy: false, error: String((e && e.message) || e) })
					})
				} },
				{ label: '退出桌宠', run: () => { store.set({ visible: false }); setMenu(null) } }
			]

			return el('div', {
				className: 'dsh-cp-pet-wrap' + (s.clickThrough ? ' dsh-cp-through' : ''),
				style: { left: Math.round(pos.x), top: Math.round(pos.y), zIndex: wrapZ, height: wrapH }
			},
				el('img', {
					ref: imgRef,
					className: 'dsh-cp-pet' + (dragging ? ' dragging' : ''),
					alt: '',
					draggable: false,
					width: frames.w,
					height: frames.h,
					style: { width: frames.w, height: frames.h, display: 'block', transform: flip },
					onMouseDown: (e) => {
						if (e.button !== 0 || s.clickThrough) return
						e.preventDefault()
						const a = animRef.current
						a.sleeping = false
						lastEventAtRef.current = Date.now()
						dragRef.current = { sx: e.clientX - pos.x, sy: e.clientY - pos.y, moved: false }
						setMenu(null)
					},
					onDoubleClick: () => {
						lastEventAtRef.current = Date.now()
						store.set({ bubble: '嘿嘿～' })
						playSeq(animRef.current, [[Math.random() < 0.5 ? 3 : 4, 900]])
						timer.timeout(() => { if (animRef.current.queue.length === 0) store.set({ bubble: null }) }, 1500)
					},
					onContextMenu: (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }
				}),
				dialogEls,
				menu ? el('div', { className: 'dsh-cp-menu', style: { left: Math.round(menu.x), top: Math.round(menu.y) } },
					el('div', { className: 'dsh-cp-title' }, String(active.displayName || active.id)),
					menuActions.map((m) => el('button', { key: m.label, onClick: m.run }, m.label))
				) : null
			)
		}

		function refresh(timer) {
			const save = saveConfig(timer)
			store.set({ busy: true, error: '' })
			return rpc('refresh').then((data) => {
				const pets = Array.isArray(data.pets) ? data.pets : []
				const active = pets.some((p) => p.dir === store.active) ? store.active : (pets[0] ? pets[0].dir : null)
				store.set({ pets, codexHome: data.codexHome || '', dshPets: data.dshPets || '', rev: data.rev || 0, active })
				save()
			}).catch((e) => {
				store.set({ error: String((e && e.message) || e) })
			}).finally(() => {
				store.set({ busy: false })
			})
		}

		function saveConfig(timer) {
			return timer.debounce(() => {
				rpc('config', currentConfig()).catch(() => {})
			}, 600)
		}
		// Shared controls used by the run-card panel and the settings page.
		function setMode(next) {
			store.set({ busy: true, error: '' })
			rpc('mode', { mode: next }).then((r) => {
				if (r && r.ok) {
					store.set({ mode: next, busy: false })
				} else if (r && r.reason === 'electron-missing') {
					store.set({ busy: false, error: '桌面版未安装：请先在 dsh-codex-pet/desktop 目录执行 npm install 安装 Electron（' + (r.desktopDir || '') + '）' })
				} else {
					store.set({ busy: false, error: String((r && r.error) || '切换失败') })
				}
			}).catch((e) => {
				store.set({ busy: false, error: String((e && e.message) || e) })
			})
		}
		function PetControls(props) {
			const s = props.s
			const timer = props.timer
			const save = react.useMemo(() => saveConfig(timer), [timer])
			return [
				el('div', { className: 'row', key: 'r0' },
					'显示模式 ',
					el('label', { style: { cursor: 'pointer' } },
						el('input', {
							type: 'radio', name: 'dsh-cp-mode', checked: s.mode !== 'desktop',
							onChange: () => { if (s.mode !== 'web') setMode('web') }
						}),
						' 网页内嵌'
					),
					el('label', { style: { cursor: 'pointer' } },
						el('input', {
							type: 'radio', name: 'dsh-cp-mode', checked: s.mode === 'desktop',
							onChange: () => { if (s.mode !== 'desktop') setMode('desktop') }
						}),
						' 独立桌面窗口'
					),
					s.mode === 'desktop' ? el('span', { className: 'desc' }, '（桌宠已在桌面显示，此页面隐藏）') : null,
					s.mode !== 'desktop' && !s.desktopReady ? el('span', { className: 'desc' }, '（桌面版未安装）') : null
				),
				el('div', { className: 'row', key: 'r1' },
					el('button', { onClick: () => refresh(timer), disabled: s.busy }, s.busy ? '扫描中…' : '重新扫描并迁移 Codex 皮肤'),
					el('button', { onClick: () => store.set({ visible: !s.visible }) }, s.visible ? '隐藏桌宠' : '显示桌宠')
				),
				el('div', { className: 'row', key: 'r2' },
					'缩放 ',
					el('input', {
						type: 'range', min: 0.5, max: 4, step: 0.25, value: s.scale,
						onChange: (e) => { store.set({ scale: Number(e.target.value) }); save() }
					}),
					' ' + s.scale.toFixed(2) + 'x',
					'速度 ',
					el('input', {
						type: 'range', min: 0.25, max: 4, step: 0.25, value: s.animationSpeed,
						onChange: (e) => { store.set({ animationSpeed: Number(e.target.value) }); save() }
					}),
					' ' + s.animationSpeed.toFixed(2) + 'x'
				),
				el('div', { className: 'row', key: 'r3' },
					el('button', { onClick: () => { store.set({ animationEnabled: !s.animationEnabled }); save() } }, s.animationEnabled ? '动画: 开' : '动画: 关'),
					el('button', { onClick: () => { store.set({ randomEnabled: !s.randomEnabled }); save() } }, s.randomEnabled ? '随机行为: 开' : '随机行为: 关'),
					el('button', { onClick: () => { store.set({ alwaysOnTop: !s.alwaysOnTop }); save() } }, s.alwaysOnTop ? '置顶: 开' : '置顶: 关'),
					el('button', { onClick: () => { store.set({ clickThrough: !s.clickThrough }); save() } }, s.clickThrough ? '点击穿透: 开' : '点击穿透: 关'),
					el('button', { onClick: () => { store.set({ hideWhenIdle: !s.hideWhenIdle }); save() } }, s.hideWhenIdle ? '空闲隐藏: 开' : '空闲隐藏: 关')
				),
				el('div', { className: 'row', key: 'r4' },
					'空闲动画间隔 ',
					el('input', {
						type: 'range', min: 8, max: 120, step: 1, value: s.idleFrequencySec,
						onChange: (e) => { store.set({ idleFrequencySec: Number(e.target.value) }); save() }
					}),
					' ' + s.idleFrequencySec + 's'
				),
				s.pets.length === 0
					? el('div', { className: 'muted', key: 'r5' }, '未发现已迁移的皮肤，请点击“重新扫描并迁移 Codex 皮肤”。')
					: el('div', { className: 'pets', key: 'r5' },
						s.pets.map((p) => el('label', { key: p.dir },
							el('input', {
								type: 'radio', name: 'dsh-cp-pet', checked: s.active === p.dir,
								onChange: () => { store.set({ active: p.dir }); save() }
							}),
							' ' + String(p.displayName || p.id),
							p.description ? el('span', { className: 'desc' }, ' — ' + String(p.description)) : null
						))
					),
				el('div', { className: 'muted', key: 'r6' },
					'聚合状态: ' + s.phase + (s.phrase ? (' · ' + s.phrase) : '') + ' · 会话数 ' + (s.sessions ? s.sessions.length : 0) + (s.lastEvent ? (' · 上次事件: ' + s.lastEvent) : '')
				)
			]
		}

		function PetPanel(props) {
			const s = useStore()
			return el('div', { className: 'dsh-cp-panel' },
				el('div', { className: 'dsh-cp-title' }, 'Codex 桌宠 · DSH'),
				PetControls({ s, timer: props.timer })
			)
		}

		function PetSettingsPage(props) {
			const s = useStore()
			return el('div', { className: 'dsh-cp-panel' },
				el('div', { className: 'dsh-cp-title' }, '桌宠'),
				el('div', { className: 'muted' }, '自动迁移 Codex 桌宠皮肤并在页面右下角显示；设置即时生效并持久化到 $DSH_HOME/pet.json。'),
				PetControls({ s, timer: props.timer }),
				el('div', { className: 'muted' }, s.dshPets ? ('已迁移 ' + s.pets.length + ' 个皮肤 → ' + s.dshPets) : ''),
				s.error ? el('div', { className: 'muted' }, '⚠ ' + s.error) : null
			)
		}

		const inject = ['slots', 'timer', 'sessions']

		function apply(ctx) {
			const slots = ctx.get('slots')
			if (slots === undefined) return
			const timer = ctx.timer
			const sessionsSvc = ctx.get('sessions')

			let lastState = ''
			const pollDisposer = timer.interval(() => {
				rpcGet('state').then((d) => {
					const key = d.phase + '|' + d.phrase + '|' + (d.project || '') + '|' + (d.lastEvent || '') + '|' + ((d.sessions || []).length) + '|' + ((d.sessions || []).map((x) => x.phase).join(','))
					if (key !== lastState) {
						lastState = key
						store.set({
							phase: d.phase || 'idle',
							phrase: d.phrase || '',
							project: d.project || '',
							sessions: Array.isArray(d.sessions) ? d.sessions : [],
							lastEvent: d.lastEvent || ''
						})
					}
				}).catch(() => { /* ignore */ })
			}, 400)

			rpcGet('pets').then((data) => {
				const pets = Array.isArray(data.pets) ? data.pets : []
				store.set({ pets, codexHome: data.codexHome || '', dshPets: data.dshPets || '', rev: data.rev || 0 })
				return rpcGet('config').then((cfg) => {
					cfg = cfg || {}
					const active = (cfg.name && pets.some((p) => p.dir === cfg.name)) ? cfg.name : (pets[0] ? pets[0].dir : null)
					store.set({
						active,
						scale: clamp(typeof cfg.scale === 'number' ? cfg.scale : 1.0, 0.5, 4),
						alwaysOnTop: cfg.alwaysOnTop !== false,
						clickThrough: !!cfg.clickThrough,
						hideWhenIdle: !!cfg.hideWhenIdle,
						animationEnabled: cfg.animationEnabled !== false,
						animationSpeed: clamp(typeof cfg.animationSpeed === 'number' ? cfg.animationSpeed : 1.0, 0.25, 4),
						idleFrequencySec: clamp(typeof cfg.idleFrequencySec === 'number' ? cfg.idleFrequencySec : 15, 8, 120)
					})
					if (typeof cfg.x === 'number' && typeof cfg.y === 'number') {
						const ww = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
						const wh = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800
						const ow = cfg.winW || ww
						const oh = cfg.winH || wh
						persistRef.x = ow > 0 ? (cfg.x / ow * ww) : cfg.x
						persistRef.y = oh > 0 ? (cfg.y / oh * wh) : cfg.y
						persistRef.winW = ww
						persistRef.winH = wh
					}
					loadedRef.current = true
					saveConfig(timer)()
				})
			}).catch((e) => {
				store.set({ error: String((e && e.message) || e) })
			})

			// Load display mode (web vs standalone desktop app)
			rpcGet('mode').then((m) => {
				store.set({
					mode: m && m.mode === 'desktop' ? 'desktop' : 'web',
					desktopReady: !!(m && m.desktopReady)
				})
			}).catch(() => { /* keep web */ })

			slots.inject('shell.overlay', () => slots.register(
				{ name: 'shell.overlay', id: 'codex-pet-overlay', order: 100 },
				() => el(PetOverlay, { timer, sessionsSvc })
			))
			slots.inject('tool.view.cordis', () => slots.register(
				{ name: 'tool.view.cordis', key: 'self' },
				() => el(PetPanel, { timer })
			))
			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'codex-pet', order: 18, label: '桌宠' },
				() => el(PetSettingsPage, { timer })
			))

			return () => {
				if (typeof pollDisposer === 'function') pollDisposer()
			}
		}

		exports.name = 'dsh-codex-pet'
		exports.inject = inject
		exports.apply = apply
		return module.exports
	}
});
