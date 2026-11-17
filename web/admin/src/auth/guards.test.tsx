import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth, RequirePermission } from './guards'
import { restoreSession } from './session'
import { useAuth } from './store'

vi.mock('./session', () => ({ restoreSession: vi.fn() }))
vi.mock('../components/Splash', () => ({ Splash: () => <p role="status">Signing in...</p> }))

const me = (permissions: string[]) =>
  ({ id: 1, name: 'A', email: 'a@example.test', is_superadmin: false, roles: [], permissions }) as never
const tokens = { access_token: 'a', expires_in: 3600 }

const at = (path: string, ui: ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

beforeEach(() => {
  useAuth.setState({ status: 'anonymous', accessToken: null, expiresAt: null, user: null, restored: false })
  vi.mocked(restoreSession).mockClear()
})
afterEach(cleanup)

function Login() {
  const state = useLocation().state as { from?: string } | null
  return <p>login page, from {state?.from}</p>
}
const app = (path: string) =>
  at(
    path,
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<RequireAuth>secret page</RequireAuth>} />
    </Routes>,
  )

describe('RequireAuth', () => {
  it('tries one silent refresh on the first visit and shows a status line meanwhile', () => {
    app('/faqs?page=2')

    expect(restoreSession).toHaveBeenCalledOnce()
    expect(screen.queryByText('secret page')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Signing in')
  })

  it('after a failed refresh goes to /login with the target in router state', () => {
    useAuth.getState().markRestored()
    app('/faqs?page=2')

    expect(restoreSession).not.toHaveBeenCalled()
    expect(screen.getByText('login page, from /faqs?page=2')).toBeTruthy()
    expect(screen.queryByText('secret page')).toBeNull()
  })

  it('waits, without redirecting, while the account is loading', () => {
    useAuth.getState().setSession(tokens)
    app('/')

    expect(screen.queryByText('secret page')).toBeNull()
    expect(screen.queryByText(/login page/)).toBeNull()
  })

  it('renders the page for a signed-in user', () => {
    useAuth.getState().setSession(tokens)
    useAuth.getState().setUser(me([]))
    app('/')

    expect(screen.getByText('secret page')).toBeTruthy()
  })
})

describe('RequirePermission', () => {
  it('renders the page when the user holds the permission', () => {
    useAuth.getState().setUser(me(['faqs.view']))
    at('/faqs', <RequirePermission permission="faqs.view">faq page</RequirePermission>)

    expect(screen.getByText('faq page')).toBeTruthy()
  })

  it('shows the 403 page when the permission is missing', () => {
    useAuth.getState().setUser(me(['posts.view']))
    at('/faqs', <RequirePermission permission="faqs.view">faq page</RequirePermission>)

    expect(screen.queryByText('faq page')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Not allowed' })).toBeTruthy()
    expect(screen.getByText('403')).toBeTruthy()
  })

  it('shows the 403 page while no user is loaded', () => {
    at('/faqs', <RequirePermission permission="faqs.view">faq page</RequirePermission>)

    expect(screen.queryByText('faq page')).toBeNull()
  })
})
