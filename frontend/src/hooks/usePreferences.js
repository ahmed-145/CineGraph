import { useCallback, useEffect, useState } from 'react'

const K = {
  excluded: 'cg.excluded',
  watchlist: 'cg.watchlist',
  lastConst: 'cg.lastConstellation',
  onboard: 'cg.onboarding',
}

function readSet(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}
function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch {}
}
function readNum(key, fallback = 0) {
  try { return parseInt(localStorage.getItem(key), 10) || fallback } catch { return fallback }
}
function writeNum(key, v) {
  try { localStorage.setItem(key, String(v)) } catch {}
}
function readStr(key) {
  try { return localStorage.getItem(key) || null } catch { return null }
}
function writeStr(key, v) {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(v))
  } catch {}
}

export function usePreferences() {
  const [excluded, setExcluded] = useState(() => readSet(K.excluded))
  const [watchlist, setWatchlist] = useState(() => readSet(K.watchlist))
  const [onboardingStep, setOnboardingStep] = useState(() => readNum(K.onboard, 0))
  const [lastConstellationId, setLastConstellationId] = useState(() => readStr(K.lastConst))

  useEffect(() => { writeSet(K.excluded, excluded) }, [excluded])
  useEffect(() => { writeSet(K.watchlist, watchlist) }, [watchlist])
  useEffect(() => { writeNum(K.onboard, onboardingStep) }, [onboardingStep])
  useEffect(() => { writeStr(K.lastConst, lastConstellationId) }, [lastConstellationId])

  const addExcluded = useCallback((id) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.add(String(id))
      return next
    })
  }, [])
  const removeExcluded = useCallback((id) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.delete(String(id))
      return next
    })
  }, [])
  const toggleWatchlist = useCallback((id) => {
    setWatchlist((prev) => {
      const next = new Set(prev)
      const k = String(id)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }, [])
  const advanceOnboarding = useCallback((step) => {
    setOnboardingStep((prev) => Math.max(prev, step))
  }, [])
  const dismissOnboarding = useCallback(() => {
    setOnboardingStep(999)
  }, [])

  return {
    excluded,
    watchlist,
    addExcluded,
    removeExcluded,
    toggleWatchlist,
    onboardingStep,
    advanceOnboarding,
    dismissOnboarding,
    lastConstellationId,
    setLastConstellationId,
  }
}
