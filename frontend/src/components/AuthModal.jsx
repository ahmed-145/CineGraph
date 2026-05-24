import { useState } from 'react'

export default function AuthModal({ auth, onClose }) {
  const [tab, setTab] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (tab === 'in') {
        await auth.signInWithEmail(email, password)
        onClose()
      } else {
        await auth.signUpWithEmail(email, password)
        setDone(true)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    try {
      await auth.signInWithGoogle()
    } catch (err) {
      setError('Google sign-in failed — make sure Google provider is enabled in Supabase → Authentication → Providers')
    }
  }

  return (
    <div className="auth-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal">
        <button className="auth-close" onClick={onClose}>×</button>
        <div className="auth-logo">Cine<span className="accent">Graph</span></div>

        {done ? (
          <div className="auth-done">
            <p>Check your email to confirm your account, then sign in.</p>
            <button className="auth-btn" onClick={() => setDone(false)}>Back to sign in</button>
          </div>
        ) : (
          <>
            <div className="auth-tabs">
              <button className={`auth-tab ${tab === 'in' ? 'auth-tab--active' : ''}`} onClick={() => setTab('in')}>Sign in</button>
              <button className={`auth-tab ${tab === 'up' ? 'auth-tab--active' : ''}`} onClick={() => setTab('up')}>Create account</button>
            </div>

            <button className="auth-google" onClick={handleGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
              Continue with Google
            </button>

            <div className="auth-divider"><span>or</span></div>

            <form onSubmit={submit} className="auth-form">
              <input
                className="auth-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <input
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              {error && <div className="auth-error">{error}</div>}
              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? 'Loading…' : tab === 'in' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
