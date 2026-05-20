const BASE = '/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, options)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

export const api = {
  search: (q) => req(`/search?q=${encodeURIComponent(q)}&limit=8`),

  expand: (tmdb_id, exclude_ids = [], offset = 0) =>
    req('/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb_id, limit: 10, offset, exclude_ids }),
    }),

  intersect: (seed_ids, exclude_ids = [], weights = {}) =>
    req('/intersect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed_ids, limit: 12, exclude_ids, weights }),
    }),

  explain: (film_id, seed_ids) =>
    req('/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ film_id, seed_ids }),
    }),

  getFilm: (tmdb_id) => req(`/film/${tmdb_id}`),

  lazyEmbed: (tmdb_id) =>
    req(`/lazy_embed/${tmdb_id}`, { method: 'POST' }),

  watchProviders: (tmdb_id) => req(`/watch_providers/${tmdb_id}`),
}
