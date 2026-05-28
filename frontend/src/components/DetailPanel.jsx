import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185'
const TMDB_LOGO = 'https://image.tmdb.org/t/p/w45'

export default function DetailPanel({
  node,
  seeds,
  onExpand,
  onAddSeed,
  onRemoveSeed,
  onClose,
  expandedIds,
  highlightedGenre,
  onHighlightGenre,
  isOnWatchlist,
  isExcluded,
  onToggleWatchlist,
  onExcludeForever,
  graphNodes = [],
  onSelectFilm,
  letterboxdEntry,
}) {
  const [explanation, setExplanation] = useState(null)
  const [loadingExplain, setLoadingExplain] = useState(false)
  const [providers, setProviders] = useState(null)
  const [similarOnCanvas, setSimilarOnCanvas] = useState([])
  const [similarUndiscovered, setSimilarUndiscovered] = useState([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)

  const isSeed = seeds.some((s) => s.id === node.id)
  const seedEntry = seeds.find((s) => s.id === node.id)
  const seedIds = seeds.map((s) => parseInt(s.id))
  const canAddSeed = !isSeed && seeds.length < 5
  const isExpanded = expandedIds.has(node.id)

  const fetchExplanation = useCallback(async () => {
    if (seedIds.length < 1 || seedIds.includes(node.tmdb_id)) return
    setLoadingExplain(true)
    try {
      const data = await api.explain(node.tmdb_id, seedIds)
      setExplanation(data.explanation)
    } catch {
      setExplanation(null)
    } finally {
      setLoadingExplain(false)
    }
  }, [node.tmdb_id, seedIds.join(',')])

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api.watchProviders(node.tmdb_id)
      setProviders(data.providers || [])
    } catch {
      setProviders([])
    }
  }, [node.tmdb_id])

  const fetchSimilar = useCallback(async () => {
    setLoadingSimilar(true)
    try {
      // Pull a wider neighborhood, then partition into on-canvas vs undiscovered
      const results = await api.expand(node.tmdb_id, [], 0)
      const onCanvasIds = new Set(graphNodes.map((n) => String(n.id ?? n.tmdb_id)))
      const onCanvas = []
      const off = []
      for (const r of results || []) {
        if (String(r.tmdb_id) === String(node.tmdb_id)) continue
        ;(onCanvasIds.has(String(r.tmdb_id)) ? onCanvas : off).push(r)
      }
      setSimilarOnCanvas(onCanvas.slice(0, 5))
      setSimilarUndiscovered(off.slice(0, 5))
    } catch {
      setSimilarOnCanvas([])
      setSimilarUndiscovered([])
    } finally {
      setLoadingSimilar(false)
    }
  }, [node.tmdb_id, graphNodes])

  useEffect(() => {
    setExplanation(null)
    setProviders(null)
    setSimilarOnCanvas([])
    setSimilarUndiscovered([])
    if (seedIds.length >= 2 && !seedIds.includes(node.tmdb_id)) {
      fetchExplanation()
    }
    fetchProviders()
    fetchSimilar()
  }, [node.id])

  const topScore = node.seedScores
    ? Object.entries(node.seedScores)
        .map(([sid, score]) => ({ sid: parseInt(sid), score }))
        .sort((a, b) => b.score - a.score)
    : []

  const letterboxdUrl = `https://letterboxd.com/search/films/${encodeURIComponent(node.title || '')}/`
  const tmdbUrl = `https://www.themoviedb.org/movie/${node.tmdb_id}`

  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose} aria-label="Close">×</button>

      <div className="detail-poster-row">
        {node.poster_path ? (
          <img src={TMDB_IMG + node.poster_path} alt={node.title} className="detail-poster" />
        ) : (
          <div className="detail-poster detail-poster--placeholder" />
        )}
        <div className="detail-meta">
          <h2 className="detail-title">{node.title}</h2>
          <div className="detail-sub">
            {node.year && <span>{node.year}</span>}
            {node.runtime && <span>{node.runtime}m</span>}
            {node.vote_average != null && <span>★ {node.vote_average.toFixed(1)}</span>}
          </div>
          {node.director && <div className="detail-director">dir. {node.director}</div>}
          {letterboxdEntry?.rating != null && (
            <div className="detail-your-rating">
              You rated {'★'.repeat(Math.floor(letterboxdEntry.rating))}
              {letterboxdEntry.rating % 1 ? '½' : ''} ({letterboxdEntry.rating})
            </div>
          )}
          {node.genres?.length > 0 && (
            <div className="detail-genres">
              {node.genres.map((g) => (
                <button
                  key={g}
                  className={`detail-genre-tag ${highlightedGenre === g ? 'detail-genre-tag--active' : ''}`}
                  onClick={() => onHighlightGenre(highlightedGenre === g ? null : g)}
                  title={`Highlight ${g} films`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {node.overview && <p className="detail-overview">{node.overview}</p>}

      {/* Per-seed similarity scores */}
      {topScore.length > 0 && (
        <div className="detail-scores">
          {topScore.map(({ sid, score }) => {
            const se = seeds.find((s) => parseInt(s.id) === sid)
            const seedTitle = se?.title || `Seed ${seeds.indexOf(se) + 1}`
            return (
              <div key={sid} className="detail-score-row">
                <span className="detail-score-dot" style={{ background: se?.color || '#fff' }} />
                <span className="detail-score-label" title={seedTitle}>
                  {seedTitle.length > 12 ? seedTitle.slice(0, 11) + '…' : seedTitle}
                </span>
                <div className="detail-score-bar-wrap">
                  <div
                    className="detail-score-bar"
                    style={{ width: `${Math.round(score * 100)}%`, background: se?.color || '#fff' }}
                  />
                </div>
                <span className="detail-score-val">{(score * 100).toFixed(0)}%</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Groq explanation */}
      {(explanation || loadingExplain) && (
        <div className="detail-explain">
          {loadingExplain ? (
            <span className="detail-explain-loading">Generating explanation…</span>
          ) : (
            <>
              <span className="detail-explain-label">Why it's here</span>
              <p>{explanation}</p>
            </>
          )}
        </div>
      )}

      {/* Similar films — on canvas + undiscovered */}
      {(similarOnCanvas.length > 0 || similarUndiscovered.length > 0 || loadingSimilar) && (
        <div className="detail-similar">
          {similarOnCanvas.length > 0 && (
            <>
              <span className="detail-section-label">On this canvas</span>
              <div className="detail-similar-list">
                {similarOnCanvas.map((f) => (
                  <button
                    key={f.tmdb_id}
                    className="detail-similar-item"
                    onClick={() => onSelectFilm?.(f)}
                  >
                    {f.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w92${f.poster_path}`} alt="" className="detail-similar-thumb" />
                    ) : (
                      <div className="detail-similar-thumb detail-similar-thumb--ph" />
                    )}
                    <span className="detail-similar-title">{f.title}</span>
                    <span className="detail-similar-score">{(f.score || 0).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {similarUndiscovered.length > 0 && (
            <>
              <span className="detail-section-label">Undiscovered</span>
              <div className="detail-similar-list">
                {similarUndiscovered.map((f) => (
                  <button
                    key={f.tmdb_id}
                    className="detail-similar-item"
                    onClick={() => onSelectFilm?.(f)}
                  >
                    {f.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w92${f.poster_path}`} alt="" className="detail-similar-thumb" />
                    ) : (
                      <div className="detail-similar-thumb detail-similar-thumb--ph" />
                    )}
                    <span className="detail-similar-title">{f.title}</span>
                    <span className="detail-similar-score detail-similar-score--new">+</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {loadingSimilar && (
            <div className="detail-explain-loading">Finding neighbours…</div>
          )}
        </div>
      )}

      {/* Streaming availability */}
      {providers && providers.length > 0 && (
        <div className="detail-streaming">
          <span className="detail-streaming-label">Streaming</span>
          <div className="detail-streaming-list">
            {providers.map((p) => (
              <div key={p.name} className="detail-streaming-item" title={p.name}>
                {p.logo ? (
                  <img src={TMDB_LOGO + p.logo} alt={p.name} className="detail-streaming-logo" />
                ) : (
                  <span className="detail-streaming-name">{p.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* External links */}
      <div className="detail-links">
        <a href={tmdbUrl} target="_blank" rel="noopener noreferrer" className="detail-link">
          TMDB
        </a>
        <a href={letterboxdUrl} target="_blank" rel="noopener noreferrer" className="detail-link">
          Letterboxd
        </a>
      </div>

      {/* Actions */}
      <div className="detail-actions">
        <button className="detail-btn detail-btn--expand" onClick={() => onExpand(node.tmdb_id)}>
          {isExpanded ? 'Expand further' : 'Expand'}
        </button>
        {isSeed ? (
          <button
            className="detail-btn detail-btn--seed detail-btn--seed-active"
            style={{ borderColor: seedEntry?.color, color: seedEntry?.color }}
            onClick={() => onRemoveSeed(node.tmdb_id)}
          >
            Remove seed
          </button>
        ) : canAddSeed ? (
          <button className="detail-btn detail-btn--seed" onClick={() => onAddSeed(node.tmdb_id)}>
            Add as seed
          </button>
        ) : null}
      </div>

      {/* Secondary actions: watchlist + permanent exclusion */}
      <div className="detail-secondary">
        <button
          className={`detail-secondary-btn ${isOnWatchlist ? 'detail-secondary-btn--on' : ''}`}
          onClick={() => onToggleWatchlist?.(node.tmdb_id)}
          title={isOnWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          <svg viewBox="0 0 24 24" fill={isOnWatchlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
          </svg>
          {isOnWatchlist ? 'On watchlist' : 'Want to watch'}
        </button>
        <button
          className="detail-secondary-btn detail-secondary-btn--danger"
          onClick={() => onExcludeForever?.(node.tmdb_id)}
          title="Never show me films like this"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          Never show
        </button>
      </div>
    </div>
  )
}
