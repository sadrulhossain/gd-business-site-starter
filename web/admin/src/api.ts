import { createClient } from '@gd/api-client'
import { getValidToken, refreshTokens } from './auth/session'
import { useAuth } from './auth/store'
import { config } from './lib/config'

/** The one API client. A 401 triggers one single-flight refresh and a retry; if that fails the session is cleared. */
export const api = createClient({
  baseUrl: config.apiBase(),
  credentials: 'include',
  getToken: getValidToken,
  onUnauthorized: async () => {
    const renewed = await refreshTokens()
    if (!renewed) useAuth.getState().clear()

    return renewed
  },
})
