import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Splash } from '../components/Splash'
import { Forbidden } from '../pages/errors'
import { restoreSession } from './session'
import { useAuth } from './store'

/**
 * Renders children only for a signed-in user whose account is loaded. On the first visit it tries one silent refresh
 * (the refresh cookie); without a session it goes to /login with the target in router state (never in storage).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const restored = useAuth((s) => s.restored)
  const location = useLocation()

  useEffect(() => {
    if (status === 'anonymous' && !restored) void restoreSession()
  }, [status, restored])

  if (status === 'authenticated' && user) return <>{children}</>
  if (status === 'anonymous' && restored) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return <Splash />
}

/** Renders children only when the user holds `permission` (the superadmin holds all); otherwise the 403 page. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const allowed = useAuth((s) => s.user?.permissions.includes(permission) ?? false)

  return allowed ? <>{children}</> : <Forbidden />
}
