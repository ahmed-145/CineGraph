import { useCallback, useEffect, useRef, useState } from 'react'
import Canvas from './components/Canvas'
import DetailPanel from './components/DetailPanel'
import HUD from './components/HUD'
import SearchBar from './components/SearchBar'
import AuthModal from './components/AuthModal'
import SaveBar from './components/SaveBar'
import { useGraph } from './hooks/useGraph'
import { useAuth } from './hooks/useAuth'
import { useConstellations, serializeCanvas } from './hooks/useConstellations'

export default function App() {
  const graphRef = useRef()
  const auth = useAuth()
  const {
    graphData,
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
  } = useGraph()

  const constellations = useConstellations(auth.token)

  const [showAuth, setShowAuth] = useState(false)
  const [currentConstellationId, setCurrentConstellationId] = useState(null)

  const isEmpty = graphData.nodes.length === 0

  const enrichedSeeds = seeds.map((s) => ({
    ...s,
    title: graphData.nodes.find((n) => n.id === s.id)?.title || '',
  }))

  // ── hover affordances ───────────────────────────────────────────────────────
  const [hoveredNode, setHoveredNode] = useState(null)
  const hoverTimerRef = useRef(null)

  const handleNodeHover = useCallback((node) => {
    clearTimeout(hoverTimerRef.current)
    if (node) {
      setHoveredNode(node)
    } else {
      hoverTimerRef.current = setTimeout(() => setHoveredNode(null), 200)
    }
  }, [])

  const affordancePos = (() => {
    if (!hoveredNode || !graphRef.current) return null
    try {
      return graphRef.current.graph2ScreenCoords(hoveredNode.x || 0, hoveredNode.y || 0)
    } catch {
      return null
    }
  })()

  const hovIsSeed = hoveredNode && seeds.some((s) => s.id === hoveredNode.id)
  const hovSeedEntry = hoveredNode && seeds.find((s) => s.id === hoveredNode.id)
  const hovCanAddSeed = hoveredNode && !hovIsSeed && seeds.length < 5
  const hovIsExpanded = hoveredNode && expandedIds.has(hoveredNode.id)

  // ── soft cap toast ──────────────────────────────────────────────────────────
  const capToastShownRef = useRef(false)
  const [showCapToast, setShowCapToast] = useState(false)

  useEffect(() => {
    if (graphData.nodes.length >= 75 && !capToastShownRef.current) {
      capToastShownRef.current = true
      setShowCapToast(true)
      const t = setTimeout(() => setShowCapToast(false), 8000)
      return () => clearTimeout(t)
    }
  }, [graphData.nodes.length])

  // ── genre highlight ─────────────────────────────────────────────────────────
  const [highlightedGenre, setHighlightedGenre] = useState(null)

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (film) => {
      summonFilm(film)
    },
    [summonFilm]
  )

  const handleNodeClick = useCallback(
    (node) => {
      touchNode(node.id)
      setSelectedNode((prev) => (prev?.id === node.id ? null : node))
      setHighlightedGenre(null)
    },
    [setSelectedNode, touchNode]
  )

  const handleExpand = useCallback(
    (tmdb_id) => {
      expandNode(tmdb_id)
      setSelectedNode(null)
      setHoveredNode(null)
    },
    [expandNode, setSelectedNode]
  )

  const handleAddSeed = useCallback(
    (tmdb_id) => {
      addSeed(tmdb_id)
      const node = graphData.nodes.find((n) => n.id === String(tmdb_id))
      if (node) setSelectedNode({ ...node, is_seed: true })
      setHoveredNode(null)
    },
    [addSeed, graphData.nodes, setSelectedNode]
  )

  const handleRemoveSeed = useCallback(
    (tmdb_id) => {
      removeSeed(tmdb_id)
      setHoveredNode(null)
    },
    [removeSeed]
  )

  // ── constellation save / load / share ──────────────────────────────────────
  const handleSave = useCallback(async (name) => {
    const data = serializeCanvas(
      graphData.nodes, graphData.links, seeds, intersectResultIds, expandedIds
    )
    const result = await constellations.save(name, data, currentConstellationId)
    setCurrentConstellationId(result.id)
  }, [graphData, seeds, intersectResultIds, expandedIds, currentConstellationId, constellations])

  const handleLoad = useCallback(async (id) => {
    const result = await constellations.load(id)
    loadConstellation(result.data)
    setCurrentConstellationId(result.id)
    setSelectedNode(null)
  }, [constellations, loadConstellation, setSelectedNode])

  const handleShare = useCallback(async () => {
    if (!currentConstellationId) {
      // Save first automatically
      const data = serializeCanvas(
        graphData.nodes, graphData.links, seeds, intersectResultIds, expandedIds
      )
      const result = await constellations.save('My Constellation', data, null)
      setCurrentConstellationId(result.id)
      return constellations.share(result.id)
    }
    return constellations.share(currentConstellationId)
  }, [currentConstellationId, graphData, seeds, intersectResultIds, expandedIds, constellations])

  // ── pan to keep the action visible (no zoom changes) ───────────────────────
  const prevNodeCount = useRef(0)
  useEffect(() => {
    const count = graphData.nodes.length
    if (count === 1 && prevNodeCount.current === 0) {
      setTimeout(() => {
        graphRef.current?.centerAt(0, 0, 500)
        graphRef.current?.zoom(1.2, 500)
      }, 100)
    }
    prevNodeCount.current = count
  }, [graphData.nodes.length])

  useEffect(() => {
    if (seeds.length < 2) return
    const seedNodes = seeds
      .map((s) => graphData.nodes.find((n) => n.id === s.id))
      .filter(Boolean)
    if (!seedNodes.length) return
    const cx = seedNodes.reduce((s, n) => s + (n.x || 0), 0) / seedNodes.length
    const cy = seedNodes.reduce((s, n) => s + (n.y || 0), 0) / seedNodes.length
    setTimeout(() => graphRef.current?.centerAt(cx, cy, 600), 200)
  }, [seeds.length])

  return (
    <div
      className="app"
      onClick={(e) => {
        if (!e.target.closest('.panel-layer') && !e.target.closest('[data-searchbar]')) {
          setHighlightedGenre(null)
        }
      }}
    >
      <div className={`app-bg app-bg--${mode}`} />

      <div className="canvas-layer">
        <Canvas
          graphData={graphData}
          seeds={enrichedSeeds}
          mode={mode}
          intersectResultIds={intersectResultIds}
          selectedNode={selectedNode}
          highlightedGenre={highlightedGenre}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          graphRef={graphRef}
        />
      </div>

      {/* Node hover affordances */}
      {hoveredNode && affordancePos && (
        <div
          className="node-affordances"
          style={{ left: affordancePos.x, top: affordancePos.y }}
          onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
          onMouseLeave={() => {
            hoverTimerRef.current = setTimeout(() => setHoveredNode(null), 200)
          }}
        >
          <button
            className="node-aff-btn node-aff-btn--expand"
            onMouseDown={(e) => { e.preventDefault(); handleExpand(hoveredNode.tmdb_id) }}
          >
            {hovIsExpanded ? '＋ more' : 'expand'}
          </button>
          {hovIsSeed ? (
            <button
              className="node-aff-btn node-aff-btn--seed node-aff-btn--active"
              style={{ color: hovSeedEntry?.color, borderColor: `${hovSeedEntry?.color}66` }}
              onMouseDown={(e) => { e.preventDefault(); handleRemoveSeed(hoveredNode.tmdb_id) }}
            >
              × seed
            </button>
          ) : hovCanAddSeed ? (
            <button
              className="node-aff-btn node-aff-btn--seed"
              onMouseDown={(e) => { e.preventDefault(); handleAddSeed(hoveredNode.tmdb_id) }}
            >
              ＋ seed
            </button>
          ) : null}
        </div>
      )}

      <div className={`search-layer ${isEmpty ? 'search-layer--center' : 'search-layer--top'}`}>
        <SearchBar onSelect={handleSelect} isEmpty={isEmpty} />
      </div>

      {!isEmpty && (
        <div className="hud-layer">
          <HUD
            mode={mode}
            seeds={enrichedSeeds}
            onRemoveSeed={handleRemoveSeed}
            nodeCount={graphData.nodes.length}
            archivedCount={archivedNodes.length}
            onRestoreArchived={restoreArchived}
          />
        </div>
      )}

      {selectedNode && (
        <div className="panel-layer">
          <DetailPanel
            node={selectedNode}
            seeds={enrichedSeeds}
            onExpand={handleExpand}
            onAddSeed={handleAddSeed}
            onRemoveSeed={handleRemoveSeed}
            onClose={() => setSelectedNode(null)}
            expandedIds={expandedIds}
            highlightedGenre={highlightedGenre}
            onHighlightGenre={setHighlightedGenre}
          />
        </div>
      )}

      <div className="savebar-layer">
        <SaveBar
          user={auth.user}
          constellations={constellations.list}
          currentId={currentConstellationId}
          saving={constellations.saving}
          sharing={constellations.sharing}
          onSignIn={() => setShowAuth(true)}
          onSignOut={auth.signOut}
          onSave={handleSave}
          onLoad={handleLoad}
          onDelete={constellations.remove}
          onShare={handleShare}
          onFetchList={constellations.fetchList}
          disabled={isEmpty}
        />
      </div>

      {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}

      {loading && <div className="loading-bar" />}

      {showCapToast && (
        <div className="cap-toast">
          <span>Canvas is getting busy — consider saving this constellation.</span>
          <button
            className="cap-toast-dismiss"
            onClick={() => setShowCapToast(false)}
          >
            ×
          </button>
        </div>
      )}

      {!isEmpty && (
        <button className="clear-btn" onClick={clearCanvas} title="Clear canvas">
          ✕ clear
        </button>
      )}
    </div>
  )
}
