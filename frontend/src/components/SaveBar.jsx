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
  disabled,
}) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [shareUrl, setShareUrl] = useState(null)
  const dropRef = useRef()

  useEffect(() => {
    if (open) onFetchList()
  }, [open, onFetchList])

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSave = useCallback(() => {
    if (!user) { onSignIn(); return }
    setNaming(true)
    setNameVal('')
  }, [user, onSignIn])

  const confirmSave = useCallback(async (e) => {
    e.preventDefault()
    const name = nameVal.trim() || 'Untitled Constellation'
    setNaming(false)
    await onSave(name)
  }, [nameVal, onSave])

  const handleShare = useCallback(async () => {
    if (!user) { onSignIn(); return }
    const url = await onShare()
    if (url) {
      setShareUrl(url)
      navigator.clipboard.writeText(url).catch(() => {})
      setTimeout(() => setShareUrl(null), 4000)
    }
  }, [user, onSignIn, onShare])

  return (
    <div className="save-bar" ref={dropRef}>
      {shareUrl && (
        <div className="save-share-toast">
          <span>Link copied!</span>
          <input className="save-share-url" value={shareUrl} readOnly onClick={(e) => e.target.select()} />
        </div>
      )}

      {naming && (
        <form className="save-name-form" onSubmit={confirmSave}>
          <input
            className="save-name-input"
            autoFocus
            placeholder="Constellation name…"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
          />
          <button type="submit" className="save-name-btn">{saving ? '…' : 'Save'}</button>
          <button type="button" className="save-name-cancel" onClick={() => setNaming(false)}>✕</button>
        </form>
      )}

      <div className="save-bar-actions">
        {!disabled && (
          <>
            <button className="save-btn" onClick={handleSave} disabled={saving} title="Save constellation">
              {saving ? '…' : '↓ Save'}
            </button>
            <button className="save-btn save-btn--share" onClick={handleShare} disabled={sharing || !currentId} title="Share constellation">
              {sharing ? '…' : '⬆ Share'}
            </button>
          </>
        )}

        {user ? (
          <div className="save-user">
            <button
              className="save-avatar"
              onClick={() => setOpen((v) => !v)}
              title={user.email}
            >
              {user.email[0].toUpperCase()}
            </button>

            {open && (
              <div className="save-dropdown">
                <div className="save-dropdown-email">{user.email}</div>
                <div className="save-dropdown-divider" />
                {constellations.length === 0 && (
                  <div className="save-dropdown-empty">No saved constellations</div>
                )}
                {constellations.map((c) => (
                  <div key={c.id} className="save-dropdown-item">
                    <button
                      className="save-dropdown-name"
                      onClick={() => { onLoad(c.id); setOpen(false) }}
                    >
                      {c.name}
                    </button>
                    <button
                      className="save-dropdown-del"
                      onClick={() => onDelete(c.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="save-dropdown-divider" />
                <button className="save-dropdown-signout" onClick={onSignOut}>Sign out</button>
              </div>
            )}
          </div>
        ) : (
          <button className="save-signin" onClick={onSignIn}>Sign in</button>
        )}
      </div>
    </div>
  )
}
