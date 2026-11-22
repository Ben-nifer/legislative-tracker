import { z } from 'zod'

// Spec §11 onboarding events (onboarding-build-planv1.1.md §4.7, B11). Every
// event has a strict schema: an unknown event or property is rejected, so no
// address or other free text can reach analytics_events.props.

const step = z.number().int().min(0).max(6)
const surveyStep = z.number().int().min(1).max(4)
// IDs only (UUIDs, place keys like "neighborhood:BK0602"): no spaces, so no free text
const safeId = z.string().regex(/^[A-Za-z0-9:_-]{1,64}$/)

export const EVENT_SCHEMAS = {
  onb_view: z.strictObject({ step }),
  onb_skip: z.strictObject({ step: surveyStep }),
  onb_explore_exit: z.strictObject({ step: surveyStep }),
  // Geoclient can't tell outside-NYC from unplaceable, so both are `failed`
  onb_address_result: z.strictObject({ result: z.enum(['success', 'failed', 'unavailable']) }),
  onb_streeteasy_click: z.strictObject({}),
  onb_select: z.strictObject({
    type: z.enum(['jurisdiction', 'neighborhood', 'politician', 'topic', 'interest']),
    id: safeId.optional(), // omitted for typed interests
    source: z.enum(['suggested', 'search', 'freetext']),
  }),
  onb_freetext_match: z.strictObject({
    cache_hit: z.boolean(),
    latency_ms: z.number().int().min(0).max(60_000),
    topics_count: z.number().int().min(0).max(50),
  }),
  onb_preview_expand: z.strictObject({}),
  onb_notif: z.strictObject({
    result: z.enum(['explainer_accept', 'explainer_decline', 'system_grant', 'system_deny']),
  }),
  onb_complete: z.strictObject({ path: z.enum(['survey', 'explore_exit', 'popular']) }),
  auth_prompt: z.strictObject({ trigger: z.enum(['s6_sheet', 'stance', 'comment', 'follow', 'header']) }),
  // Recorded server-side by the auth callback; new_account separates sign-ups from sign-ins
  auth_success: z.strictObject({ method: z.enum(['google', 'email']), new_account: z.boolean() }),
} as const

export type EventName = keyof typeof EVENT_SCHEMAS
export type EventProps<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>
export interface AnalyticsEvent<N extends EventName = EventName> {
  name: N
  props: EventProps<N>
}

export const MAX_EVENTS_PER_BATCH = 50

export function validateEvent(raw: unknown): AnalyticsEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const { name, props } = raw as { name?: unknown; props?: unknown }
  if (typeof name !== 'string' || !Object.hasOwn(EVENT_SCHEMAS, name)) return null
  const parsed = EVENT_SCHEMAS[name as EventName].safeParse(props ?? {})
  return parsed.success ? { name: name as EventName, props: parsed.data } : null
}
