import type { SupabaseClient } from '@supabase/supabase-js'

// Impression logging (recommendations-planv1.2.md §3.5, D17): what each feed load
// showed, with the widget's score components and weights version. One insert
// per feed load. Nothing reads it at request time; it feeds the §8 panel.

export type FeedSurface = 'onboarding_preview' | 'home'

export interface ImpressionLog {
  surface: FeedSurface
  sessionId: string // `sid`: the only identifier for guests. No address, IP or device data
  userId: string | null
  onlyNew?: boolean // preview refreshes log only items that weren't on screen before
}

export interface LoggedItem {
  id: string
  score: number
  signals: Record<string, unknown>
  label: string | null
  isNew: boolean
}

export interface ImpressionRow {
  user_id: string | null
  session_id: string
  surface: FeedSurface
  widget: string
  content_item_id: string
  position: number
  score: number
  signals: Record<string, unknown>
  reason: string | null
  config_version: number | null
}

// Positions are 1-based within each widget. Tracked and Friend activity aren't
// scored: they log score 0, no signals and no config version.
export function impressionRows(
  widgets: { key: string; configVersion: number | null; items: LoggedItem[] }[],
  log: ImpressionLog,
  diff: boolean
): ImpressionRow[] {
  return widgets.flatMap((w) =>
    w.items.flatMap((item, i) =>
      log.onlyNew && diff && !item.isNew
        ? []
        : [
            {
              user_id: log.userId,
              session_id: log.sessionId,
              surface: log.surface,
              widget: w.key,
              content_item_id: item.id,
              position: i + 1,
              score: item.score,
              signals: item.signals,
              reason: item.label,
              config_version: w.configVersion,
            },
          ]
    )
  )
}

export async function insertImpressions(service: SupabaseClient, rows: ImpressionRow[]): Promise<void> {
  if (!rows.length) return
  const { error } = await service.from('feed_impressions').insert(rows)
  if (error) console.error('feed_impressions insert failed:', error.message)
}

// A click is attached to the latest matching impression from this session
// (shown within the last day), so the page never waits on the impression insert.
export async function recordClick(
  service: SupabaseClient,
  click: { sessionId: string; surface: FeedSurface; widget: string; itemId: string; action: 'open' | 'stance' | 'bookmark' | 'follow' }
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await service
    .from('feed_impressions')
    .select('id')
    .eq('session_id', click.sessionId)
    .eq('surface', click.surface)
    .eq('widget', click.widget)
    .eq('content_item_id', click.itemId)
    .gte('created_at', since)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`feed_impressions lookup failed: ${error.message}`)
  if (!data) return false
  const insert = await service.from('feed_clicks').insert({ impression_id: data.id, action: click.action })
  if (insert.error) throw new Error(`feed_clicks insert failed: ${insert.error.message}`)
  return true
}
