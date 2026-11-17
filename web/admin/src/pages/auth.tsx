import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { login, loginMessage } from '../auth/session'
import { useAuth } from '../auth/store'

/** Email and password. The page the user came from travels in router state, so nothing is written to storage or the URL. */
export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const signedIn = useAuth((s) => s.status === 'authenticated')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (signedIn) return <Navigate to={from} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (e) {
      setError(loginMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto mt-16 max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <label className="block space-y-1">
          <span className="text-sm text-ink-muted">Email</span>
          <input className="field w-full" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-ink-muted">Password</span>
          <input className="field w-full" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}
