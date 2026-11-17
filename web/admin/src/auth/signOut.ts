import { api } from '../api'
import { useAuth } from './store'

/** Revokes the refresh family on the server (clears the cookie), then drops everything from memory. */
export async function signOut() {
  try {
    await api.request('POST', '/v1/logout', { headers: { 'X-Requested-With': 'gd-admin' } })
  } catch {
    // Already expired or unreachable: leaving is still right.
  }
  useAuth.getState().clear()
}
