import { useCallback, useEffect, useRef, useState } from 'react'

export default function SaveBar({
  user,
  constellations,
  currentId,
  saving,
  sharing,
  onSignIn,
  onSignOut,
  onSave,
  onLoad,
  onDelete,
  onShare,
  onFetchList,
  onStartFresh,
  disabled,
}) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [copied, setCopied] = useState(false)
  const dropRef = useRef()

  useEffect(() => {
    if (open && user) onFetchList()
  }, [open, user, onFetchList])

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false)
        setNaming(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSaveClick = useCallback(() => {
    if (!user) { onSignIn(); setOpen(false); return }
    setNaming(true)
    setNameVal('')
  }, [user, onSignIn])

  const confirmSave = useCallback(async (e) => {
    e.preventDefault()
    const name = nameVal.trim() || 'Untitled Constellation'
    setNaming(false)
    await onSave(name)
  }, [nameVal, onSave])

  const handleShareClick = useCallback(async () => {
    if (!user) { onSignIn(); setOpen(false); return }
    const url = await onShare()
    if (url) {
      navigator.clipboard.writeText(url).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }, [user, onSignIn, onShare])

  const triggerLabel = user ? user.email[0].toUpperCase() : null

  return (
    <div className="sb" ref={dropRef}>
      <button
        className={user ? 'sb-trigger sb-trigger--avatar' : 'sb-trigger sb-trigger--menu'}
        onClick={() => setOpen((v) => !v)}
        title={user ? user.email : 'Account'}
      >
        {user ? (
          triggerLabel
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
          </svg>
        )}
      </button>

      {open && (
        <div className="sb-dropdown">
          {!user ? (
            <button className="sb-item sb-item--primary" onClick={() => { onSignIn(); setOpen(false) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Sign in
            </button>
          ) : (
            <>
              <div className="sb-email">{user.email}</div>
              <div className="sb-divider" />

              {naming ? (
                <form className="sb-name-form" onSubmit={confirmSave}>
                  <input
                    className="sb-name-input"
                    autoFocus
                    placeholder="Constellation name…"
                    value={nameVal}
                    onChange={(e) => setNameVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
                  />
                  <button type="submit" className="sb-name-btn">{saving ? '…' : 'Save'}</button>
                </form>
              ) : (
                <button className="sb-item" onClick={handleSaveClick} disabled={disabled || saving}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  {saving ? 'Saving…' : 'Save constellation'}
                </button>
              )}

              <button className="sb-item" onClick={handleShareClick} disabled={!currentId || sharing}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                {copied ? 'Link copied' : sharing ? 'Sharing…' : 'Share link'}
              </button>

              {constellations.length > 0 && (
                <>
                  <div className="sb-divider" />
                  <div className="sb-section-label">Saved</div>
                  {constellations.map((c) => (
                    <div key={c.id} className={`sb-row ${c.id === currentId ? 'sb-row--current' : ''}`}>
                      <button
                        className="sb-row-name"
                        onClick={() => { onLoad(c.id); setOpen(false) }}
                        title={c.name}
                      >
                        {c.name}
                      </button>
                      <button
                        className="sb-row-del"
                        onClick={() => onDelete(c.id)}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}

              <div className="sb-divider" />
              {onStartFresh && (
                <button className="sb-item sb-item--muted" onClick={() => { onStartFresh(); setOpen(false) }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Start fresh
                </button>
              )}
              <button className="sb-item sb-item--muted" onClick={() => { onSignOut(); setOpen(false) }}>
                Sign out
              </button>
            </>
          )}
          {!user && onStartFresh && (
            <>
              <div className="sb-divider" />
              <button className="sb-item sb-item--muted" onClick={() => { onStartFresh(); setOpen(false) }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Start fresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
