import { useCallback, useState } from 'react'

const BASE = '/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, options)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function serializeCanvas(nodes, links, seeds, intersectResultIds, expandedIds) {
  return {
    nodes: nodes.map((n) => ({
      tmdb_id: n.tmdb_id,
      id: n.id,
      title: n.title,
      year: n.year,
      poster_path: n.poster_path,
      overview: n.overview,
      director: n.director,
      genres: n.genres,
      cast: n.cast,
      runtime: n.runtime,
      vote_average: n.vote_average,
      type: n.type,
      parent_id: n.parent_id ?? null,
      x: n.x ?? 0,
      y: n.y ?? 0,
      seedColors: n.seedColors ?? null,
      seedScores: n.seedScores ?? null,
      is_seed: n.is_seed ?? false,
      seed_color: n.seed_color ?? null,
    })),
    links: links.map((l) => ({
      id: l.id,
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      linkType: l.linkType,
      color: l.color ?? null,
    })),
    seeds: seeds.map((s) => ({ id: s.id, color: s.color })),
    intersectResultIds: [...intersectResultIds].map(String),
    expandedIds: [...expandedIds].map(String),
  }
}

export function useConstellations(token) {
  const [list, setList] = useState([])
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)

  const fetchList = useCallback(async () => {
    if (!token) return
    try {
      const data = await req('/constellations', { headers: authHeaders(token) })
      setList(data)
    } catch { /* ignore */ }
  }, [token])

  const save = useCallback(async (name, canvasData, existingId = null) => {
    if (!token) throw new Error('Not signed in')
    setSaving(true)
    try {
      const result = await req('/constellations', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name, data: canvasData, constellation_id: existingId }),
      })
      await fetchList()
      return result
    } finally {
      setSaving(false)
    }
  }, [token, fetchList])

  const load = useCallback(async (id) => {
    if (!token) throw new Error('Not signed in')
    return req(`/constellations/${id}`, { headers: authHeaders(token) })
  }, [token])

  const remove = useCallback(async (id) => {
    if (!token) throw new Error('Not signed in')
    await req(`/constellations/${id}`, { method: 'DELETE', headers: authHeaders(token) })
    setList((prev) => prev.filter((c) => c.id !== id))
  }, [token])

  const share = useCallback(async (id) => {
    if (!token) throw new Error('Not signed in')
    setSharing(true)
    try {
      const { slug } = await req(`/constellations/${id}/share`, {
        method: 'POST',
        headers: authHeaders(token),
      })
      return `${window.location.origin}/c/${slug}`
    } finally {
      setSharing(false)
    }
  }, [token])

  const fork = useCallback(async (slug) => {
    if (!token) throw new Error('Not signed in')
    return req(`/constellations/${slug}/fork`, {
      method: 'POST',
      headers: authHeaders(token),
    })
  }, [token])

  const getSnapshot = useCallback(async (slug) => {
    return req(`/c/${slug}`)
  }, [])

  return { list, saving, sharing, fetchList, save, load, remove, share, fork, getSnapshot }
}
