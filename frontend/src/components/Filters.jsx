import { useEffect, useRef, useState } from 'react'

// PRD §6.2 — decade / language / runtime payload filters at query time.
export default function Filters({ value = {}, onChange }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(value)
  const ref = useRef()

  useEffect(() => { setLocal(value) }, [value])

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const activeCount =
    (local.decade_min ? 1 : 0) +
    (local.decade_max ? 1 : 0) +
    (local.languages?.length ? 1 : 0) +
    (local.runtime_min ? 1 : 0) +
    (local.runtime_max ? 1 : 0)

  const apply = () => { onChange(local); setOpen(false) }
  const clear = () => { setLocal({}); onChange({}); setOpen(false) }
  const update = (patch) => setLocal((p) => ({ ...p, ...patch }))

  return (
    <div className="filters" ref={ref}>
      <button
        className={`filters-trigger ${activeCount ? 'filters-trigger--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Filters"
      >
        filters{activeCount ? ` · ${activeCount}` : ''}
      </button>

      {open && (
        <div className="filters-pop">
          <div className="filters-row">
            <label className="filters-label">Decade</label>
            <input
              className="filters-input"
              type="number"
              placeholder="min year"
              value={local.decade_min || ''}
              onChange={(e) => update({ decade_min: e.target.value ? parseInt(e.target.value) : null })}
            />
            <span className="filters-sep">–</span>
            <input
              className="filters-input"
              type="number"
              placeholder="max year"
              value={local.decade_max || ''}
              onChange={(e) => update({ decade_max: e.target.value ? parseInt(e.target.value) : null })}
            />
          </div>

          <div className="filters-row">
            <label className="filters-label">Languages</label>
            <input
              className="filters-input filters-input--wide"
              type="text"
              placeholder="en, ko, ja…"
              value={(local.languages || []).join(', ')}
              onChange={(e) => update({
                languages: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
              })}
            />
          </div>

          <div className="filters-row">
            <label className="filters-label">Runtime</label>
            <input
              className="filters-input"
              type="number"
              placeholder="min min"
              value={local.runtime_min || ''}
              onChange={(e) => update({ runtime_min: e.target.value ? parseInt(e.target.value) : null })}
            />
            <span className="filters-sep">–</span>
            <input
              className="filters-input"
              type="number"
              placeholder="max min"
              value={local.runtime_max || ''}
              onChange={(e) => update({ runtime_max: e.target.value ? parseInt(e.target.value) : null })}
            />
          </div>

          <div className="filters-actions">
            <button className="filters-btn" onClick={apply}>Apply</button>
            <button className="filters-btn filters-btn--ghost" onClick={clear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}
