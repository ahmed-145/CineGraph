import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function SearchBar({ onSelect, isEmpty }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [indexingId, setIndexingId] = useState(null)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const data = await api.search(q)
      setResults(data)
      setOpen(data.length > 0)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChange = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 220)
  }

  const handleSelect = async (film) => {
    if (film.unindexed) {
      // Lazy embed: call backend to embed this film, then summon it
      setIndexingId(film.tmdb_id)
      setOpen(false)
      try {
        const result = await api.lazyEmbed(film.tmdb_id)
        const indexed = result.film || film
        onSelect({ ...indexed, tmdb_id: film.tmdb_id })
      } catch {
        // Still summon with the TMDB data we have; expand will fail gracefully
        onSelect(film)
      } finally {
        setIndexingId(null)
      }
    } else {
      onSelect(film)
    }
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
    if (e.key === 'Enter' && results.length > 0) handleSelect(results[0])
  }

  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('[data-searchbar]')) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div
      data-searchbar
      className={`search-wrapper ${isEmpty ? 'search-center' : 'search-top'}`}
    >
      {isEmpty && (
        <>
          <div className="search-logo">Cine<span className="accent">Graph</span></div>
          <p className="search-hint">Start with any film. Find what lives between.</p>
        </>
      )}
      <div className="search-input-row">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setOpen(results.length > 0)}
          placeholder={
            indexingId
              ? 'Indexing film…'
              : isEmpty
              ? 'Search any film…'
              : 'Add another film…'
          }
          autoComplete="off"
          spellCheck="false"
          disabled={!!indexingId}
        />
        {(loading || indexingId) && <span className="search-spinner" />}
        {!isEmpty && !query && !loading && !indexingId && (
          <kbd className="search-kbd">/</kbd>
        )}
      </div>

      {open && (
        <ul className="search-dropdown">
          {results.map((film) => (
            <li
              key={film.tmdb_id}
              className={`search-result ${film.unindexed ? 'search-result--unindexed' : ''}`}
              onMouseDown={() => handleSelect(film)}
            >
              {film.poster_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w45${film.poster_path}`}
                  alt=""
                  className="search-thumb"
                />
              ) : (
                <div className="search-thumb search-thumb--placeholder" />
              )}
              <span className="search-title">{film.title}</span>
              {film.year ? <span className="search-year">{film.year}</span> : null}
              {film.unindexed && (
                <span className="search-badge">+ index</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
