import { ApiError } from '@gd/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { getValidToken, login, loginMessage, refreshTokens, restoreSession } from './session'
import { useAuth } from './store'

const me = { id: 1, name: 'A', email: 'a@example.test', is_superadmin: false, roles: [], permissions: ['faqs.view'] }
const tokens = { access_token: 'access-1', expires_in: 3600 }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const calls = (fetchMock: { mock: { calls: unknown[][] } }, path: string) => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(path))
const init = (call: unknown[]) => call[1] as RequestInit & { headers: Record<string, string> }

beforeEach(() => {
  useAuth.setState({ status: 'anonymous', accessToken: null, expiresAt: null, user: null, restored: false })
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('auth store', () => {
  it('starts anonymous and becomes authenticated only once the user is loaded', () => {
    expect(useAuth.getState().status).toBe('anonymous')
    useAuth.getState().setSession(tokens)
    expect(useAuth.getState().status).toBe('loading')
    useAuth.getState().setUser(me as never)
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('answers can() from the loaded permissions', () => {
    expect(useAuth.getState().can('faqs.view')).toBe(false)
    useAuth.getState().setUser(me as never)
    expect(useAuth.getState().can('faqs.view')).toBe(true)
    expect(useAuth.getState().can('faqs.delete')).toBe(false)
  })

  it('clear() drops everything', () => {
    useAuth.getState().setSession(tokens)
    useAuth.getState().setUser(me as never)
    useAuth.getState().clear()
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', accessToken: null, user: null, restored: true })
  })
})

describe('login', () => {
  it('posts the credentials with the cookie header, keeps the token in memory only and loads the account', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('/v1/auth/login') ? json({ ...tokens, token_type: 'Bearer' }) : json({ data: me })))
    vi.stubGlobal('fetch', fetchMock)

    await login('a@example.test', 'secret')

    const [login0] = calls(fetchMock, '/v1/auth/login')
    expect(init(login0!)).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'gd-admin' } })
    expect(JSON.parse(init(login0!).body as string)).toEqual({ email: 'a@example.test', password: 'secret' })
    expect(String(login0![0])).toBe('/api/v1/auth/login')
    expect(init(calls(fetchMock, '/v1/me')[0]!).headers.Authorization).toBe('Bearer access-1')
    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', accessToken: 'access-1' })

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('access-1')
  })

  it('a failed login leaves the user anonymous and surfaces the 422 and 429 messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unprocessable', message: 'Invalid', details: { email: ['The email field is required.'] } } }, 422)))
    const error = await login('', '').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(useAuth.getState().status).toBe('anonymous')
    expect(loginMessage(error)).toBe('The email field is required.')
    expect(loginMessage(new ApiError(429, 'too_many_requests', 'Too many login attempts. Try again in 42 seconds.'))).toBe('Too many login attempts. Try again in 42 seconds.')
    expect(loginMessage(new TypeError('network'))).toMatch(/Could not sign in/)
  })
})

describe('token refresh', () => {
  it('sends the cookie and the CSRF header, then stores the new token', async () => {
    const fetchMock = vi.fn(async () => json({ ...tokens, token_type: 'Bearer' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshTokens()).resolves.toBe(true)

    expect(init(fetchMock.mock.calls[0]!)).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'gd-admin' } })
    expect(useAuth.getState().accessToken).toBe('access-1')
  })

  it('shares one request between concurrent callers', async () => {
    const fetchMock = vi.fn(async () => json(tokens))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([refreshTokens(), refreshTokens(), refreshTokens()])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('parallel 401s cause exactly one refresh, and every request is retried with the new token', async () => {
    useAuth.getState().setSession({ access_token: 'old', expires_in: 3600 })
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string, options: RequestInit & { headers: Record<string, string> }) => {
      if (url.endsWith('/v1/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 10))
        return json({ access_token: 'new', expires_in: 3600 })
      }
      seen.push(`${url} ${options.headers.Authorization}`)
      return options.headers.Authorization === 'Bearer new' ? json({ data: [] }) : json({ error: { code: 'unauthenticated', message: 'Unauthenticated' } }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([api.request('GET', '/v1/faqs'), api.request('GET', '/v1/services'), api.request('GET', '/v1/team')])

    expect(calls(fetchMock, '/v1/auth/refresh')).toHaveLength(1)
    expect(seen.filter((s) => s.endsWith('Bearer new'))).toHaveLength(3)
    expect(init(fetchMock.mock.calls[0]!).credentials).toBe('include')
  })

  it('an expired refresh clears the session (the guard then sends the user to /login)', async () => {
    useAuth.getState().setSession(tokens)
    useAuth.getState().setUser(me as never)
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthenticated', message: 'Unauthenticated' } }, 401)))

    await expect(api.request('GET', '/v1/faqs')).rejects.toMatchObject({ status: 401 })
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', accessToken: null, user: null })
  })

  it('keeps the session on a network error', async () => {
    useAuth.getState().setSession(tokens)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))

    await expect(refreshTokens()).resolves.toBe(false)
    expect(useAuth.getState().accessToken).toBe('access-1')
  })

  it('leaves a fresh token alone and renews one that expires within 60 seconds', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'access-2', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)

    useAuth.getState().setSession({ access_token: 'access-1', expires_in: 3600 })
    await expect(getValidToken()).resolves.toBe('access-1')
    expect(fetchMock).not.toHaveBeenCalled()

    useAuth.getState().setSession({ access_token: 'access-1', expires_in: 59 })
    await expect(getValidToken()).resolves.toBe('access-2')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('restoreSession (page load)', () => {
  it('refreshes silently, loads the account and marks the attempt done', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/v1/auth/refresh') ? json(tokens) : json({ data: me }))))

    await restoreSession()
    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', restored: true })
  })

  it('without a valid refresh cookie ends anonymous but restored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthenticated', message: 'No' } }, 401)))

    await restoreSession()
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', restored: true })
  })
})
