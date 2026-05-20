import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import { useConstellations } from '../hooks/useConstellations'
import { useAuth } from '../hooks/useAuth'
import { SEED_COLORS } from '../hooks/useGraph'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92'
const NODE_R = 26
const imageCache = new Map()

function loadImage(path) {
  if (!path) return null
  const url = TMDB_IMG + path
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
  return `hsl(${hue}, 45%, 28%)`
}

export default function FrozenView() {
  const { slug } = useParams()
  const { getSnapshot, fork } = useConstellations(null)
  const auth = useAuth()
  const graphRef = useRef()

  const [snap, setSnap] = useState(null)
  const [error, setError] = useState(null)
  const [forking, setForking] = useState(false)
  const [forked, setForked] = useState(false)

  useEffect(() => {
    getSnapshot(slug)
      .then(setSnap)
      .catch(() => setError('Constellation not found.'))
  }, [slug])

  useEffect(() => {
    if (!snap) return
    snap.data.nodes?.forEach((n) => { if (n.poster_path) loadImage(n.poster_path) })
  }, [snap])

  useEffect(() => {
    if (snap && graphRef.current) {
      setTimeout(() => graphRef.current?.zoomToFit(600, 80), 300)
    }
  }, [snap])

  const handleFork = async () => {
    if (!auth.user) return
    setForking(true)
    try {
      await fork(slug)
      setForked(true)
    } finally {
      setForking(false)
    }
  }

  if (error) return (
    <div className="frozen-error">
      <p>{error}</p>
      <Link to="/" className="frozen-cta frozen-cta--primary">Start your own canvas</Link>
    </div>
  )

  if (!snap) return <div className="frozen-loading">Loading constellation…</div>

  const { data, name } = snap
  const seeds = new Set((data.seeds || []).map((s) => s.id))
  const seedColors = Object.fromEntries((data.seeds || []).map((s) => [s.id, s.color]))
  const intersectIds = new Set((data.intersectResultIds || []).map(String))

  const graphData = {
    nodes: (data.nodes || []).map((n) => ({ ...n, id: String(n.tmdb_id), fx: n.x, fy: n.y })),
    links: (data.links || []).map((l) => ({
      ...l,
      source: String(typeof l.source === 'object' ? l.source.id : l.source),
      target: String(typeof l.target === 'object' ? l.target.id : l.target),
    })),
  }

  const drawNode = (node, ctx, globalScale) => {
    const { x, y } = node
    const isSeed = seeds.has(node.id)
    const isResult = intersectIds.has(node.id)
    const color = seedColors[node.id]

    ctx.save()
    if (isSeed) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 380)
      ctx.beginPath()
      ctx.arc(x, y, NODE_R + 6 + pulse * 5, 0, 2 * Math.PI)
      ctx.strokeStyle = (color || '#00d4ff') + 'aa'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
    if (isResult && node.seedColors?.length >= 2) {
      const colors = node.seedColors
      const seg = (2 * Math.PI) / colors.length
      colors.forEach((c, i) => {
        ctx.beginPath()
        ctx.arc(x, y, NODE_R + 5, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2)
        ctx.strokeStyle = c
        ctx.lineWidth = 3
        ctx.stroke()
      })
    }
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
      const initials = node.title?.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `bold ${14 / globalScale}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(initials, x, y)
    }
    ctx.restore()
    ctx.beginPath()
    ctx.arc(x, y, NODE_R, 0, 2 * Math.PI)
    ctx.strokeStyle = isSeed ? color || '#00d4ff' : isResult ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'
    ctx.lineWidth = isSeed ? 2 : 1
    ctx.stroke()
    const label = node.title?.length > 22 ? node.title.slice(0, 21) + '…' : node.title || ''
    ctx.font = `${Math.max(9, 11 / globalScale)}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isSeed ? color || '#00d4ff' : 'rgba(255,255,255,0.75)'
    ctx.fillText(label, x, y + NODE_R + 4 / globalScale)
    ctx.restore()
  }

  const drawLink = (link, ctx) => {
    const src = link.source
    const tgt = link.target
    if (!src || !tgt || typeof src !== 'object') return
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(tgt.x, tgt.y)
    ctx.strokeStyle = link.linkType === 'intersect'
      ? (link.color || '#ffffff') + 'bb'
      : 'rgba(255,255,255,0.12)'
    ctx.lineWidth = link.linkType === 'intersect' ? 1.4 : 0.8
    ctx.stroke()
  }

  return (
    <div className="frozen-root">
      <title>{name} — CineGraph</title>

      <div className="frozen-canvas">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          backgroundColor="#0a0a0f"
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={drawLink}
          linkCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.beginPath()
            ctx.arc(node.x, node.y, NODE_R + 6, 0, 2 * Math.PI)
            ctx.fillStyle = color
            ctx.fill()
          }}
          cooldownTicks={0}
          enableNodeDrag={false}
          nodeLabel=""
          minZoom={0.2}
          maxZoom={4}
        />
      </div>

      <div className="frozen-overlay">
        <div className="frozen-header">
          <div className="frozen-name">{name}</div>
          <div className="frozen-meta">{snap.view_count} views</div>
        </div>

        <div className="frozen-ctas">
          <Link to="/" className="frozen-cta frozen-cta--primary">
            Start your own canvas
          </Link>
          {auth.user ? (
            forked ? (
              <span className="frozen-cta frozen-cta--done">Forked to your account ✓</span>
            ) : (
              <button className="frozen-cta frozen-cta--secondary" onClick={handleFork} disabled={forking}>
                {forking ? 'Forking…' : 'Fork to my account'}
              </button>
            )
          ) : (
            <Link to="/?fork=" className="frozen-cta frozen-cta--secondary">
              Sign in to fork
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
