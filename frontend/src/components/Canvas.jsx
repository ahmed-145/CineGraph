import { useCallback, useEffect, useRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { forceCollide } from 'd3-force'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92'
const NODE_R = 28          // base node radius
const RESULT_R = 34        // larger intersect result
const SEED_R = 32          // seeds slightly larger
const imageCache = new Map()

// ── color helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return v
}
function lerpHex(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

// Mood color from id — desaturated dark ember, like HTML reference moods
function moodColor(id) {
  const hue = (parseInt(id, 10) * 137) % 360
  return `hsl(${hue}, 30%, 18%)`
}
function moodColorFill(id) {
  // Even darker for the inner ember fill
  const hue = (parseInt(id, 10) * 137) % 360
  return `hsl(${hue}, 22%, 7%)`
}
function moodColorGlow(id) {
  const hue = (parseInt(id, 10) * 137) % 360
  return `hsl(${hue}, 60%, 28%)`
}

function loadImage(posterPath) {
  if (!posterPath) return null
  const url = TMDB_IMG + posterPath
  if (imageCache.has(url)) return imageCache.get(url)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => imageCache.set(url, img)
  img.onerror = () => imageCache.set(url, null)
  img.src = url
  imageCache.set(url, 'loading')
  return null
}

export default function Canvas({
  graphData,
  seeds,
  mode,
  intersectResultIds,
  selectedNode,
  highlightedGenre,
  onNodeClick,
  onNodeHover,
  onNodeRightClick,
  graphRef,
  watchlist = new Set(),
  watched = new Map(),
}) {
  const containerRef = useRef()
  const dragGroupRef = useRef(null)

  useEffect(() => {
    graphData.nodes.forEach((n) => {
      if (n.poster_path) loadImage(n.poster_path)
    })
  }, [graphData.nodes])

  // Scroll → pan
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      const fg = graphRef.current
      if (!fg || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const scale = fg.zoom() || 1
      const { x, y } = fg.centerAt()
      fg.centerAt(x + e.deltaX / scale, y + e.deltaY / scale, 0)
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [graphRef])

  // Base forces are configured so the *steady state* is correct: link force
  // is weak (decorative) so dragging a seed doesn't yank neighbours as a
  // block; collide force is at full strength so nodes can never penetrate
  // each other when you push one against the other. The bloom-window effect
  // below temporarily boosts link strength for the entry animation only.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    fg.d3Force('center', null)
    fg.d3Force('charge')?.strength(-180).distanceMax(450)
    fg.d3Force('link')?.distance(140).strength(0.06)
    fg.d3Force('collide', forceCollide(NODE_R * 1.55).strength(1.0).iterations(2))
  }, [graphRef])

  // Bloom choreography for newly placed expand children + intersect results:
  //   t=0     placed pinned at radial / cluster slots
  //   t=700   unpin AND boost link strength → strong convergence pull toward
  //           seeds, charge spreads them apart, full collide stops overlap;
  //           sim re-heated so motion is unmistakable for several seconds
  //   t=3500  link strength drops back to weak (0.06) so future seed drags
  //           do NOT yank neighbours as a block. Collide stays at 1.0 so
  //           pushing nodes into each other still cleanly displaces them.
  useEffect(() => {
    const pinned = graphData.nodes.filter((n) => n._pinned)
    if (!pinned.length) return
    const fg = graphRef.current
    if (!fg) return

    fg.d3Force('link')?.strength(0.30)
    fg.d3ReheatSimulation()

    const unpinTimer = setTimeout(() => {
      pinned.forEach((n) => {
        delete n.fx
        delete n.fy
        delete n._pinned
      })
      fg.d3ReheatSimulation()
    }, 700)

    const calmTimer = setTimeout(() => {
      fg.d3Force('link')?.strength(0.06)
    }, 3500)

    return () => {
      clearTimeout(unpinTimer)
      clearTimeout(calmTimer)
    }
  }, [graphData.nodes.length, graphRef, graphData.nodes])

  // ── single-node drag ──────────────────────────────────────────────────────
  // The library's built-in d3-drag handles the dragged node's fx/fy and
  // alphaTarget. Steady-state link strength is 0.06 — too weak to yank
  // neighbours as a block, while the full-strength collide force still lets
  // nodes shove each other out of the way on contact. No manual pinning here.
  const handleNodeDrag = useCallback(() => {}, [])

  const handleNodeDragEnd = useCallback((node) => {
    // Drag is authoritative — wherever you drop a node, that's where it stays.
    // Re-pin every dragged node so nothing rebounds via forces.
    node.fx = node.x
    node.fy = node.y
  }, [])

  // ── node draw ──────────────────────────────────────────────────────────────
  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const { x, y } = node
      const seed = seeds.find((s) => s.id === node.id)
      const seedIndex = seed ? seeds.indexOf(seed) : -1
      const isIntersectResult = intersectResultIds.has(node.id)
      const isSelected = selectedNode?.id === node.id
      const isInIntersectMode = mode === 'intersecting'
      const isGenreDimmed =
        highlightedGenre && !seed && !node.genres?.includes(highlightedGenre)
      // Context fade (HTML "context" class — non-seed, non-result during intersect)
      const isContextDim = isInIntersectMode && !seed && !isIntersectResult && node.type !== 'root'
      const isDimmed = isGenreDimmed

      const R = seed ? SEED_R : isIntersectResult ? RESULT_R : NODE_R
      const baseAlpha = isDimmed ? 0.2 : isContextDim ? 0.3 : 1

      ctx.save()
      ctx.globalAlpha = baseAlpha

      // ── Seed pulsing halo ──────────────────────────────────────────────────
      if (seed) {
        const t = (Date.now() % 2000) / 2000
        const phase = (t + (seedIndex * 0.5)) % 1
        const pulse = 0.85 + 0.15 * Math.sin(phase * Math.PI * 2)
        const haloR = (R + 22) * pulse

        const grad = ctx.createRadialGradient(x, y, R * 0.5, x, y, haloR)
        grad.addColorStop(0, seed.color + '59')   // 35%
        grad.addColorStop(0.35, seed.color + '2e') // 18%
        grad.addColorStop(1, seed.color + '00')
        ctx.beginPath()
        ctx.arc(x, y, haloR, 0, 2 * Math.PI)
        ctx.fillStyle = grad
        ctx.fill()

        // inset hairline ring
        ctx.beginPath()
        ctx.arc(x, y, R + 8, 0, 2 * Math.PI)
        ctx.strokeStyle = seed.color + '40'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // ── Intersect result conic-gradient ring ───────────────────────────────
      if (isIntersectResult && !seed) {
        const ringR = R + 5
        const segments = 64
        // Conic stops emulate HTML: cyan 0° → mid 60° → magenta 180° → mid 240° → cyan 360°
        const stops = [
          { t: 0.000, c: '#00FFD1' },
          { t: 0.167, c: '#4dd6cd' },
          { t: 0.500, c: '#b56fc0' },
          { t: 0.667, c: '#FF00A8' },
          { t: 0.833, c: '#b56fc0' },
          { t: 1.000, c: '#00FFD1' },
        ]
        const colorAt = (u) => {
          for (let i = 0; i < stops.length - 1; i++) {
            if (u >= stops[i].t && u <= stops[i + 1].t) {
              const local = (u - stops[i].t) / (stops[i + 1].t - stops[i].t)
              return lerpHex(stops[i].c, stops[i + 1].c, local)
            }
          }
          return stops[0].c
        }

        ctx.shadowColor = 'rgba(180,120,200,0.45)'
        ctx.shadowBlur = 8
        for (let i = 0; i < segments; i++) {
          const a0 = (i / segments) * Math.PI * 2 - Math.PI / 2
          const a1 = ((i + 1) / segments) * Math.PI * 2 - Math.PI / 2 + 0.005
          ctx.beginPath()
          ctx.arc(x, y, ringR, a0, a1)
          ctx.strokeStyle = colorAt(i / segments)
          ctx.lineWidth = 2.5
          ctx.stroke()
        }
        ctx.shadowBlur = 0
      }

      // ── Selected outline ──────────────────────────────────────────────────
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, R + (isIntersectResult ? 10 : 4), 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      // ── Circle body: dark ember radial gradient ───────────────────────────
      const moodHi = moodColorGlow(node.id)
      const moodMd = moodColor(node.id)
      const moodLo = moodColorFill(node.id)

      // Outer mood glow (box-shadow analog from HTML's 0 0 18px var(--mood))
      ctx.shadowColor = moodMd
      ctx.shadowBlur = 16

      ctx.beginPath()
      ctx.arc(x, y, R, 0, 2 * Math.PI)
      const ember = ctx.createRadialGradient(x, y - R * 0.18, R * 0.1, x, y, R)
      ember.addColorStop(0, moodHi)
      ember.addColorStop(0.55, moodMd)
      ember.addColorStop(1, moodLo)
      ctx.fillStyle = ember
      ctx.fill()
      ctx.shadowBlur = 0

      // Poster overlay (low opacity so the mood ember shows through)
      const img = node.poster_path ? imageCache.get(TMDB_IMG + node.poster_path) : null
      if (img && img !== 'loading' && img.complete && img.naturalWidth > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, R, 0, 2 * Math.PI)
        ctx.clip()
        ctx.globalAlpha = baseAlpha * 0.65
        ctx.drawImage(img, x - R, y - R, R * 2, R * 2)
        ctx.restore()
      }

      // Subtle inset highlight + rim
      ctx.beginPath()
      ctx.arc(x, y, R, 0, 2 * Math.PI)
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Dark vignette inside (matches HTML inner 0 0 18px rgba(0,0,0,0.5) inset)
      const vign = ctx.createRadialGradient(x, y, R * 0.55, x, y, R)
      vign.addColorStop(0, 'rgba(0,0,0,0)')
      vign.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.beginPath()
      ctx.arc(x, y, R, 0, 2 * Math.PI)
      ctx.fillStyle = vign
      ctx.fill()

      // ── Watched indicator (green check ring, bottom-right) ───────────────
      if (watched.has(node.id)) {
        const cx2 = x + R * 0.62
        const cy2 = y + R * 0.62
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx2, cy2, 5.5, 0, 2 * Math.PI)
        ctx.fillStyle = '#0a0a0a'
        ctx.fill()
        ctx.strokeStyle = '#7CFFB2'
        ctx.lineWidth = 1.2
        ctx.stroke()
        // checkmark
        ctx.beginPath()
        ctx.moveTo(cx2 - 2.4, cy2 + 0.2)
        ctx.lineTo(cx2 - 0.6, cy2 + 2)
        ctx.lineTo(cx2 + 2.6, cy2 - 2.2)
        ctx.strokeStyle = '#7CFFB2'
        ctx.lineWidth = 1.4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
        ctx.restore()
      }

      // ── Watchlist indicator (small gold star top-right) ──────────────────
      if (watchlist.has(node.id)) {
        const sx = x + R * 0.65
        const sy = y - R * 0.65
        ctx.save()
        ctx.shadowColor = '#FFD66B'
        ctx.shadowBlur = 6
        ctx.fillStyle = '#FFD66B'
        ctx.beginPath()
        // five-point star
        const spikes = 5
        const outerR = 4.5
        const innerR = 2
        let rot = -Math.PI / 2
        const step = Math.PI / spikes
        ctx.moveTo(sx + Math.cos(rot) * outerR, sy + Math.sin(rot) * outerR)
        for (let i = 0; i < spikes; i++) {
          rot += step
          ctx.lineTo(sx + Math.cos(rot) * innerR, sy + Math.sin(rot) * innerR)
          rot += step
          ctx.lineTo(sx + Math.cos(rot) * outerR, sy + Math.sin(rot) * outerR)
        }
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      // ── Title label (plain text below, like HTML) ─────────────────────────
      const maxLen = 22
      const label =
        node.title?.length > maxLen ? node.title.slice(0, maxLen - 1) + '…' : node.title || ''
      const fontSize = Math.max(9, 11 / globalScale)
      ctx.font = `400 ${fontSize}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = seed
        ? seed.color
        : isContextDim
        ? 'rgba(232,232,232,0.4)'
        : 'rgba(232,232,232,0.78)'
      ctx.fillText(label, x, y + R + 8 / globalScale)

      ctx.restore()
    },
    [seeds, intersectResultIds, selectedNode, mode, highlightedGenre, watchlist, watched]
  )

  // Keep RAF alive after sim cools so halos + edge dash animation keep ticking.
  // Do NOT lock every node's fx/fy here — free bodies should stay reactive.
  const handleEngineStop = useCallback(() => {
    graphRef.current?.resumeAnimation()
  }, [graphRef])

  // ── link draw: curved bezier + dash flow for intersect ────────────────────
  const drawLink = useCallback((link, ctx) => {
    const src = link.source
    const tgt = link.target
    if (!src || !tgt || typeof src !== 'object' || typeof tgt !== 'object') return

    if (link.linkType === 'intersect') {
      const color = link.color || '#00FFD1'
      const dx = tgt.x - src.x
      const dy = tgt.y - src.y
      const len = Math.hypot(dx, dy) || 1

      // Alternate curve sign by stable hash of link id
      const idStr = String(link.id || '')
      let sign = 1
      for (let i = 0; i < idStr.length; i++) sign ^= idStr.charCodeAt(i)
      sign = sign & 1 ? 1 : -1

      const off = 40
      const mx = (src.x + tgt.x) / 2 + (-dy / len) * off * sign
      const my = (src.y + tgt.y) / 2 + (dx / len) * off * sign

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y)
      ctx.setLineDash([2, 6])
      // flowing animation — offset moves over time
      ctx.lineDashOffset = -((Date.now() / 30) % 200)
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1
      ctx.shadowColor = color
      ctx.shadowBlur = 3
      ctx.stroke()
      ctx.restore()
      return
    }

    // expand & other links — subtle straight gray
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(tgt.x, tgt.y)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 0.7
    ctx.stroke()
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.beginPath()
          ctx.arc(node.x, node.y, NODE_R + 10, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkCanvasObject={drawLink}
        linkCanvasObjectMode={() => 'replace'}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onNodeRightClick={onNodeRightClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onEngineStop={handleEngineStop}
        cooldownTicks={Infinity}
        cooldownTime={Infinity}
        d3AlphaDecay={0.018}
        d3VelocityDecay={0.42}
        d3AlphaMin={0.0005}
        enableNodeDrag
        enablePanInteraction
        enableZoomInteraction
        minZoom={0.2}
        maxZoom={5}
        nodeLabel=""
      />
    </div>
  )
}
