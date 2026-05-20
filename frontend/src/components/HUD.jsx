export default function HUD({ mode, seeds, onRemoveSeed, nodeCount, archivedCount, onRestoreArchived }) {
  const modeLabel = () => {
    if (mode === 'intersecting' && seeds.length >= 2) {
      return seeds.map((s, i) => (
        <span key={s.id}>
          {i > 0 && <span className="hud-times"> × </span>}
          <span style={{ color: s.color }}>{s.title || `Film ${i + 1}`}</span>
        </span>
      ))
    }
    if (mode === 'exploring') {
      return <span style={{ color: seeds[0]?.color || 'inherit' }}>Exploring</span>
    }
    return null
  }

  const label = modeLabel()

  return (
    <div className="hud">
      {label && (
        <div className={`hud-chip hud-chip--${mode}`}>
          <span className="hud-mode-word">
            {mode === 'intersecting' ? 'Intersecting ' : 'Exploring '}
          </span>
          {label}
        </div>
      )}

      {seeds.length > 0 && (
        <div className="hud-seeds">
          {seeds.map((seed, i) => (
            <button
              key={seed.id}
              className="hud-seed-pill"
              style={{ borderColor: seed.color, color: seed.color }}
              onClick={() => onRemoveSeed(parseInt(seed.id))}
              title="Remove seed"
            >
              <span className="hud-seed-dot" style={{ background: seed.color }} />
              {seed.title || `Seed ${i + 1}`}
              <span className="hud-seed-remove">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="hud-footer">
        <span className="hud-node-count">{nodeCount} films</span>
        {archivedCount > 0 && (
          <button className="hud-archived-pill" onClick={onRestoreArchived} title="Restore last archived film">
            +{archivedCount} archived
          </button>
        )}
      </div>
    </div>
  )
}
