import { ApiError } from '@gd/api-client'
import { config } from '../lib/config'
import type { Me } from '../types'
import { useAuth, type TokenResponse } from './store'

/** Renew when the access token expires within this many milliseconds. */
export const RENEW_WITHIN_MS = 60_000

const url = (path: string) => `${config.apiBase()}${path}`
const cookieCall = (path: string, body?: unknown): Promise<Response> =>
  fetch(url(path), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-Requested-With': 'gd-admin', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function failure(response: Response): Promise<ApiError> {
  const payload = (await response.json().catch(() => undefined)) as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | undefined
  return new ApiError(response.status, payload?.error?.code ?? 'http_error', payload?.error?.message ?? response.statusText, payload?.error?.details)
}

/** Message for the login form: the 422 field message and the 429 text from the API, else a plain sentence. */
export function loginMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return Object.values(error.details ?? {})[0]?.[0] ?? error.message
    if (error.status === 429) return error.message || 'Too many attempts. Try again in a minute.'
    if (error.status === 401) return error.message || 'These credentials do not match our records.'
  }
  return 'Could not sign in. Check your connection and try again.'
}

/** Email and password; the refresh cookie arrives as Set-Cookie, the access token only in the body (kept in memory). */
export async function login(email: string, password: string): Promise<Me> {
  const response = await cookieCall('/v1/auth/login', { email, password })
  if (!response.ok) throw await failure(response)

  useAuth.getState().setSession((await response.json()) as TokenResponse)
  return loadUser()
}

/** Fetches /me and marks the session authenticated (the menu loads its own query right after). */
export async function loadUser(): Promise<Me> {
  const token = await getValidToken()
  const response = await fetch(url('/v1/me'), { credentials: 'include', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
  if (!response.ok) throw await failure(response)

  const user = ((await response.json()) as { data: Me }).data
  useAuth.getState().setUser(user)
  return user
}

let inflight: Promise<boolean> | null = null

/**
 * Renews the access token from the refresh cookie. One request at a time: concurrent callers share it. Resolves false
 * when the server refused (the session is cleared, so the guards send the user to /login) and also on a network error
 * (the session is kept).
 */
export function refreshTokens(): Promise<boolean> {
  inflight ??= doRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

async function doRefresh(): Promise<boolean> {
  try {
    const response = await cookieCall('/v1/auth/refresh')
    if (!response.ok) {
      useAuth.getState().clear()
      return false
    }
    useAuth.getState().setSession((await response.json()) as TokenResponse)
    return true
  } catch {
    return false
  }
}

/** Current access token, renewed first when it expires within 60 seconds. */
export async function getValidToken(): Promise<string | null> {
  const { accessToken, expiresAt } = useAuth.getState()
  if (accessToken && expiresAt !== null && expiresAt - Date.now() < RENEW_WITHIN_MS) await refreshTokens()
  return useAuth.getState().accessToken
}

let restoring: Promise<void> | null = null

/** On page load: one silent refresh, then the account. Failure leaves the user anonymous (the guard shows /login). */
export function restoreSession(): Promise<void> {
  restoring ??= (async () => {
    try {
      if (await refreshTokens()) await loadUser()
    } catch {
      useAuth.getState().clear()
    } finally {
      useAuth.getState().markRestored()
      restoring = null
    }
  })()
  return restoring
}
