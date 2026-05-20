import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const SEED_COLORS = ['#00d4ff', '#ff00aa', '#ffcc00', '#00ff88', '#ff6600']
const NODE_SPREAD = 160
const INTERSECT_SPREAD = 130
const AUTO_FADE_THRESHOLD = 100
const SOFT_CAP = 75
const TOUCH_GRACE_MS = 60_000

function radialPositions(cx, cy, n, radius = NODE_SPREAD) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
  })
}

function clusterPositions(cx, cy, n, radius = INTERSECT_SPREAD) {
  if (n === 1) return [{ x: cx, y: cy }]
  return radialPositions(cx, cy, n, radius)
}

function midpoint(nodes) {
  if (!nodes.length) return { x: 0, y: 0 }
  return {
    x: nodes.reduce((s, n) => s + (n.x || 0), 0) / nodes.length,
    y: nodes.reduce((s, n) => s + (n.y || 0), 0) / nodes.length,
  }
}

export function useGraph() {
  const [nodes, setNodes] = useState([])
  const [links, setLinks] = useState([])
  const [seeds, setSeeds] = useState([])
  const [mode, setMode] = useState('idle')
  const [selectedNode, setSelectedNode] = useState(null)
  const [loading, setLoading] = useState(false)
  const [intersectResultIds, setIntersectResultIds] = useState(new Set())
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [archivedNodes, setArchivedNodes] = useState([])

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const seedsRef = useRef(seeds)
  seedsRef.current = seeds
  const lastTouchedRef = useRef(new Map()) // node id → timestamp

  const getNode = useCallback((id) => nodesRef.current.find((n) => n.id === String(id)), [])

  const touchNode = useCallback((id) => {
    lastTouchedRef.current.set(String(id), Date.now())
  }, [])

  // Auto-fade when canvas exceeds 100 nodes
  useEffect(() => {
    if (nodes.length <= AUTO_FADE_THRESHOLD) return
    const now = Date.now()
    const seedIds = new Set(seedsRef.current.map((s) => s.id))

    const eligible = nodes.filter(
      (n) =>
        !seedIds.has(n.id) &&
        n.type !== 'intersect_result' &&
        (now - (lastTouchedRef.current.get(n.id) || 0)) > TOUCH_GRACE_MS
    )
    if (!eligible.length) return

    eligible.sort(
      (a, b) =>
        (lastTouchedRef.current.get(a.id) || 0) - (lastTouchedRef.current.get(b.id) || 0)
    )
    const victim = eligible[0]
    lastTouchedRef.current.delete(victim.id)

    setArchivedNodes((prev) => [victim, ...prev].slice(0, 20))
    setNodes((prev) => prev.filter((n) => n.id !== victim.id))
    setLinks((prev) =>
      prev.filter((l) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source
        const tgt = typeof l.target === 'object' ? l.target.id : l.target
        return src !== victim.id && tgt !== victim.id
      })
    )
  }, [nodes.length])

  const restoreArchived = useCallback(() => {
    if (!archivedNodes.length) return
    const [toRestore, ...rest] = archivedNodes
    setArchivedNodes(rest)
    lastTouchedRef.current.set(toRestore.id, Date.now())
    setNodes((prev) => {
      if (prev.find((n) => n.id === toRestore.id)) return prev
      return [...prev, { ...toRestore, fx: toRestore.x, fy: toRestore.y, _pinned: true }]
    })
  }, [archivedNodes])

  const summonFilm = useCallback((film) => {
    const id = String(film.tmdb_id)
    if (nodesRef.current.find((n) => n.id === id)) return
    const existing = nodesRef.current
    const pos =
      existing.length === 0
        ? { x: 0, y: 0 }
        : { x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300 }
    lastTouchedRef.current.set(id, Date.now())
    setNodes((prev) => [...prev, { ...film, id, type: 'root', ...pos }])
  }, [])

  const expandNode = useCallback(
    async (tmdb_id) => {
      const parent = getNode(tmdb_id)
      if (!parent) return
      setLoading(true)
      lastTouchedRef.current.set(String(tmdb_id), Date.now())
      const currentIds = nodesRef.current.map((n) => parseInt(n.id))
      const offset = expandedIds.has(String(tmdb_id))
        ? nodesRef.current.filter((n) => n.parent_id === String(tmdb_id)).length
        : 0

      try {
        const results = await api.expand(tmdb_id, currentIds, offset)
        const positions = radialPositions(parent.x || 0, parent.y || 0, results.length)
        const now = Date.now()

        const newNodes = results.map((film, i) => {
          const id = String(film.tmdb_id)
          lastTouchedRef.current.set(id, now)
          return {
            ...film,
            id,
            type: 'expand_child',
            parent_id: String(tmdb_id),
            x: positions[i].x,
            y: positions[i].y,
            fx: positions[i].x,
            fy: positions[i].y,
            _pinned: true,
          }
        })

        const newLinks = results.map((film) => ({
          id: `${tmdb_id}-${film.tmdb_id}`,
          source: String(tmdb_id),
          target: String(film.tmdb_id),
          linkType: 'expand',
        }))

        setNodes((prev) => {
          const existingIds = new Set(prev.map((n) => n.id))
          return [...prev, ...newNodes.filter((n) => !existingIds.has(n.id))]
        })
        setLinks((prev) => {
          const existingIds = new Set(prev.map((l) => l.id))
          return [...prev, ...newLinks.filter((l) => !existingIds.has(l.id))]
        })
        setExpandedIds((prev) => new Set([...prev, String(tmdb_id)]))
        if (seedsRef.current.length === 0) setMode('exploring')
      } finally {
        setLoading(false)
      }
    },
    [getNode, expandedIds]
  )

  const runIntersect = useCallback(
    async (currentSeeds) => {
      if (currentSeeds.length < 2) return
      setLoading(true)
      const seedIds = currentSeeds.map((s) => parseInt(s.id))
      const seedNodes = currentSeeds.map((s) => getNode(s.id)).filter(Boolean)
      const mid = midpoint(seedNodes)
      const currentIds = nodesRef.current.map((n) => parseInt(n.id))
      const exclude = currentIds.filter((id) => !seedIds.includes(id))

      try {
        const results = await api.intersect(seedIds, exclude)
        const positions = clusterPositions(mid.x, mid.y, results.length)
        const now = Date.now()

        const newNodes = results.map((film, i) => {
          const id = String(film.tmdb_id)
          lastTouchedRef.current.set(id, now)
          return {
            ...film,
            id,
            type: 'intersect_result',
            seedColors: currentSeeds.map((s) => s.color),
            seedScores: film.scores || {},
            x: positions[i].x,
            y: positions[i].y,
            fx: positions[i].x,
            fy: positions[i].y,
            _pinned: true,
          }
        })

        const newLinks = []
        for (const film of results) {
          for (const seed of currentSeeds) {
            newLinks.push({
              id: `intersect-${seed.id}-${film.tmdb_id}`,
              source: seed.id,
              target: String(film.tmdb_id),
              linkType: 'intersect',
              color: seed.color,
            })
          }
        }

        const resultIds = new Set(results.map((f) => String(f.tmdb_id)))
        setIntersectResultIds(resultIds)

        setNodes((prev) => {
          const existingIds = new Set(prev.map((n) => n.id))
          const kept = prev.filter((n) => !resultIds.has(n.id) || n.type === 'intersect_result')
          const fresh = newNodes.filter((n) => !existingIds.has(n.id))
          const updated = kept.map((n) =>
            resultIds.has(n.id) ? newNodes.find((nn) => nn.id === n.id) || n : n
          )
          return [...updated, ...fresh]
        })

        setLinks((prev) => {
          const keptLinks = prev.filter((l) => l.linkType !== 'intersect')
          const existingIds = new Set(keptLinks.map((l) => l.id))
          return [...keptLinks, ...newLinks.filter((l) => !existingIds.has(l.id))]
        })
      } finally {
        setLoading(false)
      }
    },
    [getNode]
  )

  const addSeed = useCallback(
    (tmdb_id) => {
      const id = String(tmdb_id)
      if (seedsRef.current.find((s) => s.id === id)) return
      if (seedsRef.current.length >= 5) return
      const color = SEED_COLORS[seedsRef.current.length]
      const newSeeds = [...seedsRef.current, { id, color }]
      setSeeds(newSeeds)
      touchNode(id)
      if (newSeeds.length >= 2) {
        setMode('intersecting')
        runIntersect(newSeeds)
      } else {
        setMode('exploring')
      }
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_seed: true, seed_color: color } : n))
      )
    },
    [runIntersect, touchNode]
  )

  const removeSeed = useCallback(
    (tmdb_id) => {
      const id = String(tmdb_id)
      const newSeeds = seedsRef.current.filter((s) => s.id !== id)
      const recolored = newSeeds.map((s, i) => ({ ...s, color: SEED_COLORS[i] }))
      setSeeds(recolored)
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === id) return { ...n, is_seed: false, seed_color: null }
          const entry = recolored.find((s) => s.id === n.id)
          if (entry) return { ...n, seed_color: entry.color }
          return n
        })
      )
      if (recolored.length >= 2) {
        runIntersect(recolored)
      } else {
        setMode(recolored.length === 1 ? 'exploring' : nodes.length > 0 ? 'exploring' : 'idle')
        setIntersectResultIds(new Set())
        setLinks((prev) => prev.filter((l) => l.linkType !== 'intersect'))
        setNodes((prev) => prev.filter((n) => n.type !== 'intersect_result'))
      }
    },
    [runIntersect, nodes.length]
  )

  const clearCanvas = useCallback(() => {
    setNodes([])
    setLinks([])
    setSeeds([])
    setMode('idle')
    setSelectedNode(null)
    setIntersectResultIds(new Set())
    setExpandedIds(new Set())
    setArchivedNodes([])
    lastTouchedRef.current.clear()
  }, [])

  const loadConstellation = useCallback((data) => {
    lastTouchedRef.current.clear()
    const now = Date.now()

    const loadedNodes = (data.nodes || []).map((n) => {
      lastTouchedRef.current.set(String(n.tmdb_id), now)
      return { ...n, id: String(n.tmdb_id), fx: n.x, fy: n.y }
    })
    const loadedLinks = (data.links || []).map((l) => ({
      ...l,
      source: typeof l.source === 'object' ? l.source.id : String(l.source),
      target: typeof l.target === 'object' ? l.target.id : String(l.target),
    }))
    const loadedSeeds = data.seeds || []
    const resultIds = new Set((data.intersectResultIds || []).map(String))
    const expIds = new Set((data.expandedIds || []).map(String))

    setNodes(loadedNodes)
    setLinks(loadedLinks)
    setSeeds(loadedSeeds)
    setIntersectResultIds(resultIds)
    setExpandedIds(expIds)
    setArchivedNodes([])
    setSelectedNode(null)
    setMode(
      loadedSeeds.length >= 2 ? 'intersecting'
      : loadedNodes.length > 0 ? 'exploring'
      : 'idle'
    )
  }, [])

  return {
    graphData: { nodes, links },
    seeds,
    mode,
    selectedNode,
    setSelectedNode,
    loading,
    intersectResultIds,
    expandedIds,
    archivedNodes,
    summonFilm,
    expandNode,
    addSeed,
    removeSeed,
    clearCanvas,
    touchNode,
    restoreArchived,
    loadConstellation,
  }
}
