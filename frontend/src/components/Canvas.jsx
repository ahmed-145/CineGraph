import { useCallback, useEffect, useRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { forceCollide } from 'd3-force'
import { SEED_COLORS } from '../hooks/useGraph'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92'
const NODE_R = 26
const imageCache = new Map()

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

function filmColor(id) {
  const hue = (parseInt(id, 10) * 137) % 360
  // 60% saturation, richer midtones — OLED neon palette spec
  return `hsl(${hue}, 60%, 22%)`
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
  graphRef,
}) {
  const containerRef = useRef()
  const dragGroupRef = useRef(null)

  useEffect(() => {
    graphData.nodes.forEach((n) => {
      if (n.poster_path) loadImage(n.poster_path)
    })
  }, [graphData.nodes])

  // Scroll to pan — intercept wheel before d3-zoom; ctrl/meta still zooms
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

  // Configure forces and unpin freshly-placed nodes after settle window
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return

    fg.d3Force('charge')?.strength(-180)
    fg.d3Force('link')?.distance(100).strength(0.35)
    fg.d3Force('collide', forceCollide(NODE_R * 1.4))
    fg.d3Force('center')?.strength(0.02)
    fg.d3ReheatSimulation()

    // After nodes animate to their pinned positions, release them so the sim
    // can settle them naturally, then onEngineStop re-freezes everything.
    const timer = setTimeout(() => {
      graphData.nodes.forEach((node) => {
        if (node._pinned) {
          delete node.fx
          delete node.fy
          delete node._pinned
        }
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [graphData.nodes.length, graphRef, graphData.nodes])

  // ── group drag (spring-lerp following) ────────────────────────────────────
  // Each drag frame we compute totalDelta from the drag start, then lerp each
  // neighbour toward (basePos + totalDelta). Neighbours stay pinned so d3 forces
  // can't fight us mid-drag. On drag end we unpin them and let the sim settle;
  // onEngineStop re-freezes once the sim cools.

  const handleNodeDrag = useCallback((node) => {
    const fg = graphRef.current
    if (!fg) return
    const nodeId = String(node.id ?? node.tmdb_id)

    if (!dragGroupRef.current) {
      // First call — collect direct neighbours and snapshot their positions
      const seen = new Set([nodeId])
      const group = []

      const linkForce = fg.d3Force('link')
      const links = linkForce ? linkForce.links() : graphData.links

      links.forEach((l) => {
        const srcId = typeof l.source === 'object'
          ? String(l.source.id ?? l.source.tmdb_id) : String(l.source)
        const tgtId = typeof l.target === 'object'
          ? String(l.target.id ?? l.target.tmdb_id) : String(l.target)

        let cn = null
        if (srcId === nodeId && typeof l.target === 'object') cn = l.target
        else if (tgtId === nodeId && typeof l.source === 'object') cn = l.source
        if (!cn) return

        const cnId = String(cn.id ?? cn.tmdb_id)
        if (seen.has(cnId)) return
        seen.add(cnId)

        cn._dragBx = cn.x ?? 0
        cn._dragBy = cn.y ?? 0
        group.push(cn)
      })

      dragGroupRef.current = { group, sx: node.x, sy: node.y }
      return
    }

    // Subsequent calls — spring-lerp each neighbour toward base + totalDelta
    const { group, sx, sy } = dragGroupRef.current
    const tdx = node.x - sx
    const tdy = node.y - sy
    const k = 0.28  // spring factor per frame (~10 frames to 97% of target)

    group.forEach((cn) => {
      const tx = cn._dragBx + tdx
      const ty = cn._dragBy + tdy
      cn.x += (tx - cn.x) * k
      cn.y += (ty - cn.y) * k
      cn.fx = cn.x
      cn.fy = cn.y
    })
  }, [graphRef, graphData.links])

  const handleNodeDragEnd = useCallback((node) => {
    node.fx = node.x
    node.fy = node.y
    // Unpin neighbours so physics can make final micro-adjustments
    if (dragGroupRef.current?.group) {
      dragGroupRef.current.group.forEach((cn) => {
        delete cn.fx
        delete cn.fy
        delete cn._dragBx
        delete cn._dragBy
      })
    }
    dragGroupRef.current = null
  }, [])

  // ── node draw ──────────────────────────────────────────────────────────────
  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const { x, y } = node
      const seed = seeds.find((s) => s.id === node.id)
      const isIntersectResult = intersectResultIds.has(node.id)
      const isSelected = selectedNode?.id === node.id
      const isInIntersectMode = mode === 'intersecting'
      const isGenreDimmed =
        highlightedGenre && !seed && !node.genres?.includes(highlightedGenre)
      const isDimmed =
        isGenreDimmed ||
        (isInIntersectMode && !seed && !isIntersectResult && node.type !== 'root')

      ctx.save()
      ctx.globalAlpha = isDimmed ? 0.2 : 1

      // Seed pulsing halo + OLED neon glow (text-shadow equivalent via shadowBlur)
      if (seed) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 420)
        const haloR = NODE_R + 6 + pulse * 5
        const grad = ctx.createRadialGradient(x, y, NODE_R * 0.5, x, y, haloR + 8)
        grad.addColorStop(0, seed.color + '66')
        grad.addColorStop(0.5, seed.color + '28')
        grad.addColorStop(1, seed.color + '00')
        ctx.beginPath()
        ctx.arc(x, y, haloR + 8, 0, 2 * Math.PI)
        ctx.fillStyle = grad
        ctx.fill()

        // Neon glow ring — OLED spec: minimal glow 0 0 10px
        ctx.beginPath()
        ctx.arc(x, y, NODE_R + 2, 0, 2 * Math.PI)
        ctx.strokeStyle = seed.color + 'aa'
        ctx.lineWidth = 1.5
        ctx.shadowColor = seed.color
        ctx.shadowBlur = 14
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // Intersect result: arc segments per seed color
      if (isIntersectResult && node.seedColors?.length >= 2) {
        const colors = node.seedColors
        const segAngle = (2 * Math.PI) / colors.length
        colors.forEach((color, i) => {
          ctx.beginPath()
          ctx.arc(x, y, NODE_R + 4, i * segAngle - Math.PI / 2, (i + 1) * segAngle - Math.PI / 2)
          ctx.strokeStyle = color
          ctx.lineWidth = 2.5
          ctx.stroke()
        })
      }

      // Selected ring
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, NODE_R + 3.5, 0, 2 * Math.PI)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Poster image or color fallback
      ctx.beginPath()
      ctx.arc(x, y, NODE_R, 0, 2 * Math.PI)
      ctx.save()
      ctx.clip()

      const img = node.poster_path ? imageCache.get(TMDB_IMG + node.poster_path) : null
      if (img && img !== 'loading' && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x - NODE_R, y - NODE_R, NODE_R * 2, NODE_R * 2)
      } else {
        ctx.fillStyle = filmColor(node.id)
        ctx.fillRect(x - NODE_R, y - NODE_R, NODE_R * 2, NODE_R * 2)
        const initials = node.title
          ?.split(' ')
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
          .toUpperCase() || '?'
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.font = `bold ${Math.max(11, 14 / globalScale)}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(initials, x, y)
      }
      ctx.restore()

      // Node border
      ctx.beginPath()
      ctx.arc(x, y, NODE_R, 0, 2 * Math.PI)
      ctx.strokeStyle = seed
        ? seed.color
        : isIntersectResult
        ? 'rgba(255,255,255,0.45)'
        : 'rgba(255,255,255,0.15)'
      ctx.lineWidth = seed ? 2.5 : 1
      ctx.stroke()

      // Title label — pill background for legibility
      const maxLen = 20
      const label =
        node.title?.length > maxLen ? node.title.slice(0, maxLen - 1) + '…' : node.title || ''
      const fontSize = Math.max(9, 11 / globalScale)
      ctx.font = `500 ${fontSize}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'

      const labelY = y + NODE_R + 5 / globalScale
      const textW = ctx.measureText(label).width
      const padX = 5 / globalScale
      const padY = 3 / globalScale
      const pillH = fontSize + padY * 2
      const pillX = x - textW / 2 - padX
      const pillW = textW + padX * 2
      const r = pillH / 2

      ctx.fillStyle = 'rgba(6,6,11,0.72)'
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(pillX, labelY - padY, pillW, pillH, r)
      } else {
        ctx.rect(pillX, labelY - padY, pillW, pillH)
      }
      ctx.fill()

      ctx.fillStyle = seed ? seed.color : 'rgba(255,255,255,0.88)'
      ctx.fillText(label, x, labelY)

      ctx.restore()
    },
    [seeds, intersectResultIds, selectedNode, mode, highlightedGenre]
  )

  // Freeze every node once the sim cools, then immediately resume the RAF loop.
  // Without resumeAnimation(), react-force-graph cancels its canvas loop when the
  // simulation stops — drag events reheat d3 but the canvas never redraws.
  const handleEngineStop = useCallback(() => {
    graphData.nodes.forEach((node) => {
      node.fx = node.x
      node.fy = node.y
    })
    graphRef.current?.resumeAnimation()
  }, [graphData.nodes, graphRef])

  const drawLink = useCallback((link, ctx) => {
    const src = link.source
    const tgt = link.target
    if (!src || !tgt || typeof src !== 'object') return

    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(tgt.x, tgt.y)

    if (link.linkType === 'expand') {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 0.7
    } else if (link.linkType === 'intersect') {
      ctx.strokeStyle = (link.color || '#ffffff') + 'aa'
      ctx.lineWidth = 1.2
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 0.7
    }
    ctx.stroke()
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        backgroundColor="#000005"
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.beginPath()
          ctx.arc(node.x, node.y, NODE_R + 8, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkCanvasObject={drawLink}
        linkCanvasObjectMode={() => 'replace'}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onEngineStop={handleEngineStop}
        cooldownTicks={150}
        d3AlphaDecay={0.035}
        d3VelocityDecay={0.75}
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
