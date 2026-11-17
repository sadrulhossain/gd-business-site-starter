import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from '@gd/api-client'
import { api } from '../api'
import { useAuth } from '../auth/store'
import { toast } from './Toast'

export interface SiteStatus {
  dirty: boolean
  last_dispatched_at: string | null
}

/** Seconds the button stays disabled after a publish (the API allows one per minute). */
export const PUBLISH_COOLDOWN_SECONDS = 60

/** Text for the indicator: waiting changes plus the time of the last build. */
export function statusText(status: SiteStatus, locale?: string): string {
  const last = status.last_dispatched_at ? `Last build ${new Date(status.last_dispatched_at).toLocaleString(locale)}` : 'No build yet'

  return status.dirty ? `Changes waiting. ${last}` : `Up to date. ${last}`
}

/** Header indicator (site.view) and the "Publish now" button (site.publish). */
export function PublishStatus() {
  const can = useAuth((s) => s.can)
  const queryClient = useQueryClient()
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const status = useQuery({
    queryKey: ['site-status'],
    enabled: can('site.view'),
    refetchInterval: 60_000,
    queryFn: async () => ((await api.request('GET', '/v1/site/status')) as { data: SiteStatus }).data,
  })

  useEffect(() => {
    if (until <= Date.now()) return
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [until])

  const publish = useMutation({
    mutationFn: () => api.request('POST', '/v1/site/publish'),
    onSuccess: () => {
      setUntil(Date.now() + PUBLISH_COOLDOWN_SECONDS * 1000)
      setNow(Date.now())
      toast.success('Publishing started. The live site updates in a few minutes.')
      void queryClient.invalidateQueries({ queryKey: ['site-status'] })
    },
    onError: (error) => toast.error(error instanceof ApiError && error.status === 429 ? 'Wait a minute before publishing again.' : 'Could not start publishing'),
  })

  if (!can('site.view') || !status.data) return null

  const waiting = Math.max(0, Math.ceil((until - now) / 1000))

  return (
    <div className="flex items-center gap-2">
      <span role="status" className={`hidden max-w-64 truncate text-sm md:inline ${status.data.dirty ? 'font-semibold text-primary-700' : 'text-ink-muted'}`} title={statusText(status.data)}>
        {statusText(status.data)}
      </span>
      {can('site.publish') && (
        <>
          <button type="button" className="btn btn-primary" disabled={publish.isPending || waiting > 0} onClick={() => publish.mutate()}>
            {waiting > 0 ? `Publish now (${waiting}s)` : 'Publish now'}
          </button>
          <span className="sr-only">The live site updates a few minutes after publishing.</span>
        </>
      )}
    </div>
  )
}
