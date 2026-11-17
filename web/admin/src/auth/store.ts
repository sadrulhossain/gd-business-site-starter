import { create } from 'zustand'
import type { Me } from '../types'

export interface TokenResponse {
  access_token: string
  /** Seconds. */
  expires_in: number
}

/**
 * Auth state, memory only: no persist middleware, nothing in localStorage or sessionStorage. The refresh token is an
 * httpOnly cookie the page cannot read; a reload starts empty and gets a new access token from POST /auth/refresh.
 *
 * status: anonymous (no token) -> loading (token, user not fetched yet) -> authenticated.
 * `restored` turns true once the first silent refresh attempt has finished, so the guards do not repeat it.
 */
interface AuthState {
  status: 'anonymous' | 'loading' | 'authenticated'
  accessToken: string | null
  /** Epoch ms. */
  expiresAt: number | null
  user: Me | null
  restored: boolean
  setSession: (tokens: TokenResponse) => void
  setUser: (user: Me) => void
  markRestored: () => void
  clear: () => void
  can: (permission: string) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'anonymous',
  accessToken: null,
  expiresAt: null,
  user: null,
  restored: false,

  setSession: (tokens) =>
    set({
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      status: get().user ? 'authenticated' : 'loading',
    }),

  setUser: (user) => set({ user, status: 'authenticated' }),

  markRestored: () => set({ restored: true }),

  clear: () => set({ status: 'anonymous', accessToken: null, expiresAt: null, user: null, restored: true }),

  can: (permission) => get().user?.permissions.includes(permission) ?? false,
}))
