export default function HUD({
  mode, seeds, onRemoveSeed, nodeCount, archivedCount, onRestoreArchived,
  resultCount = 0, seedWeights = {}, onSeedWeight,
}) {
  const isIntersecting = mode === 'intersecting' && seeds.length >= 2
  const isExploring = mode === 'exploring'

  return (
    <div className="hud">
      {(isIntersecting || isExploring) && (
        <div className="hud-chip">
          <span className="hud-mode-word">
            {isIntersecting ? 'Intersecting' : 'Exploring'}
          </span>
          {isIntersecting ? (
            <>
              {seeds.map((s, i) => (
                <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && <span className="hud-times">×</span>}
                  <span className="hud-seed-dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                  <span style={{ fontWeight: 500 }}>{s.title || `Film ${i + 1}`}</span>
                </span>
              ))}
              {resultCount > 0 && (
                <span className="hud-results-count">{resultCount} results</span>
              )}
            </>
          ) : (
            seeds[0] && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="hud-seed-dot" style={{ background: seeds[0].color, boxShadow: `0 0 8px ${seeds[0].color}` }} />
                <span style={{ fontWeight: 500 }}>{seeds[0].title}</span>
              </span>
            )
          )}
        </div>
      )}

      {seeds.length > 0 && (
        <div className="hud-seeds">
          {seeds.map((seed, i) => {
            const weight = typeof seedWeights[seed.id] === 'number' ? seedWeights[seed.id] : 1
            return (
              <div key={seed.id} className="hud-seed-row">
                <button
                  className="hud-seed-pill"
                  style={{ borderColor: `${seed.color}55`, color: seed.color }}
                  onClick={() => onRemoveSeed(parseInt(seed.id))}
                  title="Remove seed"
                >
                  <span className="hud-seed-dot" style={{ background: seed.color, boxShadow: `0 0 6px ${seed.color}` }} />
                  <span className="hud-seed-title">{seed.title || `Seed ${i + 1}`}</span>
                  <span className="hud-seed-remove">×</span>
                </button>
                {isIntersecting && onSeedWeight && (
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.1"
                    value={weight}
                    onChange={(e) => onSeedWeight(seed.id, parseFloat(e.target.value))}
                    className="hud-weight"
                    style={{ color: seed.color }}
                    title={`Weight: ${weight.toFixed(1)}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="hud-footer">
        <span className="hud-node-count">{nodeCount} nodes</span>
        {archivedCount > 0 && (
          <button className="hud-archived-pill" onClick={onRestoreArchived} title="Restore last archived film">
            +{archivedCount} archived
          </button>
        )}
      </div>
    </div>
  )
}
