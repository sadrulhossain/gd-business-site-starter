import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/store'
import { PublishStatus, statusText } from './PublishStatus'

const request = vi.fn()
vi.mock('../api', () => ({ api: { request: (...a: unknown[]) => request(...a) } }))

const me = (permissions: string[]) => ({ id: 1, name: 'A', email: 'a@x.test', is_superadmin: false, roles: [], permissions }) as never
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PublishStatus />
    </QueryClientProvider>,
  )

beforeEach(() => {
  request.mockReset()
  request.mockImplementation(async (method: string) => (method === 'GET' ? { data: { dirty: true, last_dispatched_at: '2026-11-18T10:00:00Z' } } : undefined))
})
afterEach(cleanup)

describe('PublishStatus', () => {
  it('describes waiting changes and the last build', () => {
    expect(statusText({ dirty: true, last_dispatched_at: '2026-11-18T10:00:00Z' }, 'en-GB')).toMatch(/^Changes waiting\. Last build /)
    expect(statusText({ dirty: false, last_dispatched_at: null })).toBe('Up to date. No build yet')
  })

  it('shows nothing without site.view', () => {
    useAuth.getState().setUser(me([]))
    show()
    expect(screen.queryByRole('status')).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('shows the status but no button with site.view only', async () => {
    useAuth.getState().setUser(me(['site.view']))
    show()
    expect((await screen.findByRole('status')).textContent).toContain('Changes waiting')
    expect(screen.queryByRole('button', { name: /Publish now/ })).toBeNull()
  })

  it('publishes once and disables the button for 60 seconds', async () => {
    useAuth.getState().setUser(me(['site.view', 'site.publish']))
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/site/publish'))
    const button = await screen.findByRole('button', { name: /Publish now \(\d+s\)/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
