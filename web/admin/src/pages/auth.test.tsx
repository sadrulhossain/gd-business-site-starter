import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@gd/api-client'
import { login } from '../auth/session'
import { Login } from './auth'

vi.mock('../auth/session', async (original) => ({ ...(await original<typeof import('../auth/session')>()), login: vi.fn() }))
afterEach(cleanup)

const show = () =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/faqs' } }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/faqs" element={<p>faqs page</p>} />
      </Routes>
    </MemoryRouter>,
  )
const fill = () => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@x.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Login page', () => {
  it('shows the API message when sign-in fails and stays on the page', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(429, 'too_many_requests', 'Too many login attempts. Try again in 42 seconds.'))
    show()
    fill()

    expect((await screen.findByRole('alert')).textContent).toBe('Too many login attempts. Try again in 42 seconds.')
    expect(screen.queryByText('faqs page')).toBeNull()
  })

  it('goes back to the page the user came from after signing in', async () => {
    vi.mocked(login).mockResolvedValue({} as never)
    show()
    fill()

    await waitFor(() => expect(screen.getByText('faqs page')).toBeTruthy())
  })
})
