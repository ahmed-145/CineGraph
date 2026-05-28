import { useCallback, useEffect, useRef, useState } from 'react'

const BASE = '/api'

export function useLetterboxd(token) {
  // Map of tmdb_id(string) → { rating, rewatch, watched_date }
  const [watched, setWatched] = useState(() => new Map())
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null) // { status, total, resolved, matched, unmatched }
  const pollRef = useRef(null)

  const fetchWatched = useCallback(async () => {
    if (!token) { setWatched(new Map()); return }
    try {
      const res = await fetch(`${BASE}/letterboxd/films`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const rows = await res.json()
      const map = new Map()
      for (const r of rows) {
        map.set(String(r.tmdb_id), {
          rating: r.rating,
          rewatch: r.rewatch,
          watched_date: r.watched_date,
        })
      }
      setWatched(map)
    } catch { /* ignore */ }
  }, [token])

  useEffect(() => { fetchWatched() }, [fetchWatched])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const startImport = useCallback(async (fileList) => {
    if (!token) throw new Error('Sign in to import')
    setImporting(true)
    setProgress({ status: 'uploading', total: 0, resolved: 0, matched: 0, unmatched: 0 })
    try {
      const form = new FormData()
      for (const f of fileList) form.append('files', f)
      const res = await fetch(`${BASE}/letterboxd/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const { job_id } = await res.json()

      // Poll until done
      await new Promise((resolve, reject) => {
        pollRef.current = setInterval(async () => {
          try {
            const pr = await fetch(`${BASE}/letterboxd/import/${job_id}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!pr.ok) return
            const job = await pr.json()
            setProgress(job)
            if (job.status === 'done') {
              clearInterval(pollRef.current)
              resolve()
            } else if (job.status === 'error') {
              clearInterval(pollRef.current)
              reject(new Error(job.error || 'Import failed'))
            }
          } catch { /* keep polling */ }
        }, 1000)
      })
      await fetchWatched()
    } finally {
      setImporting(false)
    }
  }, [token, fetchWatched])

  const clearLibrary = useCallback(async () => {
    if (!token) return
    await fetch(`${BASE}/letterboxd/films`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setWatched(new Map())
  }, [token])

  return { watched, importing, progress, startImport, clearLibrary, fetchWatched }
}
