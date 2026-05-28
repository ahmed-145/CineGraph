import { useRef, useState } from 'react'

export default function LetterboxdModal({ onClose, onImport, importing, progress, watchedCount, onClear }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const inputRef = useRef()

  const handleFiles = (fileList) => {
    const arr = [...fileList].filter((f) => f.name.endsWith('.csv'))
    setFiles(arr)
    setError(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const submit = async () => {
    if (!files.length) { setError('Add at least one .csv file'); return }
    setError(null)
    try {
      await onImport(files)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const pct = progress && progress.total
    ? Math.round((progress.resolved / progress.total) * 100)
    : 0

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="lb-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose}>×</button>
        <div className="lb-title">Personalize with <span className="accent">Letterboxd</span></div>
        <p className="lb-blurb">
          Export your data from Letterboxd (Settings → Import &amp; Export → Export Your Data),
          then drop <code>ratings.csv</code> and/or <code>watched.csv</code> here. We'll mark
          films you've seen and weight intersections by your ratings.
        </p>

        {watchedCount > 0 && (
          <div className="lb-current">
            <span>{watchedCount} films in your library</span>
            <button className="lb-clear" onClick={onClear} disabled={importing}>Clear</button>
          </div>
        )}

        {!importing && (
          <>
            <div
              className="lb-drop"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleFiles(e.target.files)}
              />
              {files.length ? (
                <div className="lb-filelist">
                  {files.map((f) => <div key={f.name} className="lb-file">{f.name}</div>)}
                </div>
              ) : (
                <span className="lb-drop-hint">Drop CSV files here or click to browse</span>
              )}
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="lb-import-btn" onClick={submit} disabled={!files.length}>
              Import {files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
            </button>
          </>
        )}

        {importing && progress && (
          <div className="lb-progress">
            <div className="lb-progress-status">
              {progress.status === 'resolving' && `Resolving films… ${progress.resolved}/${progress.total}`}
              {progress.status === 'storing' && 'Saving your library…'}
              {progress.status === 'parsing' && 'Reading CSV…'}
              {progress.status === 'uploading' && 'Uploading…'}
              {progress.status === 'done' && `Done — ${progress.matched} films matched`}
            </div>
            <div className="lb-bar-track">
              <div className="lb-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {progress.status === 'done' && (
              <div className="lb-progress-detail">
                {progress.matched} matched · {progress.unmatched} couldn't be resolved
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
