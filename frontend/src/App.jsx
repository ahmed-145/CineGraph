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
import { usePreferences } from './hooks/usePreferences'

function moodHslFor(id) {
  const hue = (parseInt(id, 10) * 137) % 360
  return `hsl(${hue}, 35%, 22%)`
}

function NodeHoverCard({
  node, pos, isSeed, seedEntry, canAddSeed, isExpanded,
  onExpand, onAddSeed, onRemoveSeed, onMouseEnter, onMouseLeave,
}) {
  const mood = moodHslFor(node.id ?? node.tmdb_id ?? '0')
  const posterUrl = node.poster_path
    ? `https://image.tmdb.org/t/p/w185${node.poster_path}`
    : null
  const sub = [node.year, node.director].filter(Boolean).join(' · ')
  const explain = node.explain || node.overview || ''
  const trimmedExplain = explain.length > 140 ? explain.slice(0, 138) + '…' : explain

  return (
    <div
      className="node-card"
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="node-card-poster" style={{ '--mood': mood }}>
        {posterUrl ? (
          <img src={posterUrl} alt="" className="node-card-img" />
        ) : (
          <div className="poster-art" />
        )}
        {isSeed ? (
          <button
            className="affordance affordance-add"
            title="Remove seed"
            style={{ color: seedEntry?.color }}
            onMouseDown={(e) => { e.preventDefault(); onRemoveSeed(node.tmdb_id ?? node.id) }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="12" r="5" />
              <circle cx="15" cy="12" r="5" />
            </svg>
          </button>
        ) : canAddSeed ? (
          <button
            className="affordance affordance-add"
            title="Add as seed"
            onMouseDown={(e) => { e.preventDefault(); onAddSeed(node.tmdb_id ?? node.id) }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="9" cy="12" r="5" />
              <circle cx="15" cy="12" r="5" />
            </svg>
          </button>
        ) : null}
        <button
          className="affordance affordance-expand"
          title={isExpanded ? 'Expand more' : 'Expand'}
          onMouseDown={(e) => { e.preventDefault(); onExpand(node.tmdb_id ?? node.id) }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 9V4h5" />
            <path d="M20 9V4h-5" />
            <path d="M4 15v5h5" />
            <path d="M20 15v5h-5" />
          </svg>
        </button>
      </div>
      <div className="node-card-meta">
        <div className="node-card-title">{node.title}</div>
        {sub && <div className="node-card-sub">{sub}</div>}
        {trimmedExplain && <div className="node-card-explain">{trimmedExplain}</div>}
      </div>
    </div>
  )
}

function Onboarding({ step, onDismiss }) {
  // 0 = before first summon (search-bar placeholder handles this)
  // 1 = after first summon (prompt to expand)
  // 2 = after first expand (prompt to add 2nd seed)
  // 3 = after first intersect (prompt to save)
  // >=4 = done / dismissed
  if (step < 1 || step >= 4) return null
  const messages = {
    1: 'Hover any node and click expand — see what lives near it.',
    2: 'Pick two films as seeds — find what lives between them.',
    3: 'Save your constellation from the top-right menu.',
  }
  return (
    <div className="onboard-tip" data-step={step}>
      <span className="onboard-step">{step} / 3</span>
      <span className="onboard-msg">{messages[step]}</span>
      <button className="onboard-dismiss" onClick={onDismiss} title="Dismiss">×</button>
    </div>
  )
}

function Starfield() {
  const stars = useRef(null)
  if (!stars.current) {
    let s = 1337
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
    stars.current = Array.from({ length: 110 }, () => ({
      size: rnd() < 0.08 ? 2 : 1,
      left: rnd() * 100,
      top: rnd() * 100,
      opacity: (0.15 + rnd() * 0.55).toFixed(2),
    }))
  }
  return (
    <div className="starfield">
      {stars.current.map((st, i) => (
        <div
          key={i}
          className="star"
          style={{
            width: `${st.size}px`,
            height: `${st.size}px`,
            left: `${st.left}%`,
            top: `${st.top}%`,
            opacity: st.opacity,
          }}
        />
      ))}
    </div>
  )
}

export default function App() {
  const graphRef = useRef()
  const auth = useAuth()
  const prefs = usePreferences()
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
    removeNode,
    seedWeights,
    setSeedWeight,
  } = useGraph(prefs.excluded)

  const constellations = useConstellations(auth.token)

  const [showAuth, setShowAuth] = useState(false)
  const [currentConstellationId, setCurrentConstellationId] = useState(null)
  const autoLoadedRef = useRef(false)

  // ── auto-load last active constellation on sign-in ────────────────────────
  useEffect(() => {
    if (!auth.user || autoLoadedRef.current) return
    if (!prefs.lastConstellationId) return
    autoLoadedRef.current = true
    constellations
      .load(prefs.lastConstellationId)
      .then((result) => {
        if (result?.data) {
          loadConstellation(result.data)
          setCurrentConstellationId(result.id)
        }
      })
      .catch(() => {})
  }, [auth.user, prefs.lastConstellationId, constellations, loadConstellation])

  const isEmpty = graphData.nodes.length === 0

  const enrichedSeeds = seeds.map((s) => ({
    ...s,
    title: graphData.nodes.find((n) => n.id === s.id)?.title || '',
  }))

  // ── hover affordances ───────────────────────────────────────────────────────
  const [hoveredNode, setHoveredNode] = useState(null)
  const hoverTimerRef = useRef(null)      // delayed close
  const hoverShowTimerRef = useRef(null)  // delayed open (hover intent)

  const handleNodeHover = useCallback((node) => {
    clearTimeout(hoverTimerRef.current)
    clearTimeout(hoverShowTimerRef.current)
    if (node) {
      // 700ms hover intent — drag never triggers this
      hoverShowTimerRef.current = setTimeout(() => setHoveredNode(node), 700)
    } else {
      hoverTimerRef.current = setTimeout(() => setHoveredNode(null), 200)
    }
  }, [])

  // Cancel the pending poster card the instant a drag begins on the canvas
  useEffect(() => {
    const el = document.querySelector('.canvas-layer')
    if (!el) return
    const onDown = () => {
      clearTimeout(hoverShowTimerRef.current)
      setHoveredNode(null)
    }
    el.addEventListener('mousedown', onDown)
    return () => el.removeEventListener('mousedown', onDown)
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

  // ── onboarding step advancement ────────────────────────────────────────────
  useEffect(() => {
    if (graphData.nodes.length >= 1) prefs.advanceOnboarding(1)
  }, [graphData.nodes.length])
  useEffect(() => {
    if (expandedIds.size >= 1) prefs.advanceOnboarding(2)
  }, [expandedIds])
  useEffect(() => {
    if (intersectResultIds.size >= 1) prefs.advanceOnboarding(3)
  }, [intersectResultIds])

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

  const handleToggleWatchlist = useCallback(
    (tmdb_id) => {
      prefs.toggleWatchlist(tmdb_id)
    },
    [prefs]
  )

  const handleExcludeForever = useCallback(
    (tmdb_id) => {
      prefs.addExcluded(tmdb_id)
      removeNode(tmdb_id)
      setHoveredNode(null)
    },
    [prefs, removeNode]
  )

  // ── constellation save / load / share ──────────────────────────────────────
  const handleSave = useCallback(async (name) => {
    const data = serializeCanvas(
      graphData.nodes, graphData.links, seeds, intersectResultIds, expandedIds
    )
    const result = await constellations.save(name, data, currentConstellationId)
    setCurrentConstellationId(result.id)
    prefs.setLastConstellationId(result.id)
  }, [graphData, seeds, intersectResultIds, expandedIds, currentConstellationId, constellations, prefs])

  const handleLoad = useCallback(async (id) => {
    const result = await constellations.load(id)
    loadConstellation(result.data)
    setCurrentConstellationId(result.id)
    prefs.setLastConstellationId(result.id)
    setSelectedNode(null)
  }, [constellations, loadConstellation, setSelectedNode, prefs])

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
      <Starfield />
      <div className={`intersection-fog ${mode === 'intersecting' ? 'intersection-fog--on' : ''}`} />

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
          watchlist={prefs.watchlist}
        />
      </div>

      {/* Hover poster card — matches Explore Canvas.html expanded state */}
      {hoveredNode && affordancePos && (
        <NodeHoverCard
          node={hoveredNode}
          pos={affordancePos}
          isSeed={hovIsSeed}
          seedEntry={hovSeedEntry}
          canAddSeed={hovCanAddSeed}
          isExpanded={hovIsExpanded}
          onExpand={handleExpand}
          onAddSeed={handleAddSeed}
          onRemoveSeed={handleRemoveSeed}
          onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
          onMouseLeave={() => {
            hoverTimerRef.current = setTimeout(() => setHoveredNode(null), 200)
          }}
        />
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
            resultCount={intersectResultIds.size}
            seedWeights={seedWeights}
            onSeedWeight={setSeedWeight}
          />
        </div>
      )}

      <div className={`top-right-bar ${selectedNode ? 'top-right-bar--shifted' : ''}`}>
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
        <div className="mode-toggle">
          <button className="active">Explore</button>
          <button disabled title="Requires Letterboxd import (coming soon)">Library</button>
        </div>
      </div>

      <div className="bottom-left-bar">
        <div className="live-status">
          <span className="dot-live" />LIVE
        </div>
        {!isEmpty && (
          <button className="clear-btn" onClick={clearCanvas} title="Clear canvas">
            ✕ clear
          </button>
        )}
      </div>

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
            isOnWatchlist={prefs.watchlist.has(String(selectedNode.id))}
            isExcluded={prefs.excluded.has(String(selectedNode.id))}
            onToggleWatchlist={handleToggleWatchlist}
            onExcludeForever={handleExcludeForever}
          />
        </div>
      )}

      <Onboarding
        step={prefs.onboardingStep}
        onDismiss={prefs.dismissOnboarding}
      />

      {prefs.excluded.size > 0 && (
        <button
          className="excluded-counter"
          onClick={() => {
            if (confirm(`Reset ${prefs.excluded.size} permanently-excluded film(s)?`)) {
              [...prefs.excluded].forEach((id) => prefs.removeExcluded(id))
            }
          }}
          title="Click to reset"
        >
          {prefs.excluded.size} excluded
        </button>
      )}

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

    </div>
  )
}
