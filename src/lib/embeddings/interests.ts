import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhrase } from './normalize'
import {
  type Place,
  type PlaceType,
  askHaikuForPlace,
  detectPlace,
  loadGazetteer,
  looksLikePlace,
  validateHaikuParse,
} from './places'
import { EMBEDDING_MODEL, embed, toPgVector } from './voyage'
import { loadRankingConfig } from '../ranking/config'
import { rankInterestWidget } from '../ranking/precompute'
import type { WidgetItem } from '../ranking/score'

// Free-text interests → topic widgets (recommendations-planv1.2.md §5.3, D13, D18, D25, D26).
// Chip taps never come through here. A typed phrase costs at most one Voyage
// call in the request, and only the first time anyone types it. The optional
// Haiku place parse runs after the response.

export { normalizePhrase }

export const MAX_PHRASE_LENGTH = 80
const DEFAULT_ITEM_COUNT = 20
const TOPIC_SUGGESTION_COUNT = 3

// Weight changes reach on-demand ranking within a minute
const CONFIG_MAX_AGE_MS = 60_000

// A background parse not finished after this long is assumed dead and re-queued
const PARSE_STALE_SECONDS = 300

// A topic is suggested only above the floor AND within the margin of the
// best-matching topic. Generic topics ("Small Business") score ~0.35–0.45
// against almost any phrase, so a floor alone suggests noise. Set from a
// first pass on real phrases (Phase 2); revisit with Q4 in Phase 5.
export const TOPIC_SUGGESTION_FLOOR = 0.4
export const TOPIC_SUGGESTION_MARGIN = 0.06

export type JurisdictionLevel = 'federal' | 'state' | 'city' | 'neighborhood'

export interface TopicSuggestion {
  id: string
  name: string
  slug: string
  similarity: number
}

export interface ResolvedInterest {
  widgetKey: string // interest:{normalized phrase}, shared by everyone who types it
  displayPhrase: string
  normalizedPhrase: string // the cache key; stored in user_interests on sign-up
  topicText: string // what was embedded: the phrase minus its place
  place: Place | null
  comingSoon: boolean // the place isn't covered yet ("we don't cover California yet")
  parsePending: boolean // a Haiku place parse is running; call again shortly to get the re-ranked widget
  cached: boolean // false = this request wrote the phrase cache row
  model: string
  configVersion: number // ranking_config version that scored the widget
  items: WidgetItem[] // the shared interest widget, §6.4 topic formula + sponsor cap
  relatedTopics: TopicSuggestion[]
}

export type ScheduleTask = (task: () => Promise<void>) => void

interface CachedParse {
  topic_text: string
  place_type: PlaceType | null
  place_id: string | null
  parse_method: string
  parse_pending: boolean
}

// The vector for topicText: copied from a cached phrase that is exactly topicText
// ("park slope bike lanes" reuses "bike lanes"), otherwise one Voyage call.
async function topicEmbedding(
  supabase: SupabaseClient,
  topicText: string,
  normalizedPhrase: string
): Promise<{ p_embedding?: string; p_copy_from?: string }> {
  if (topicText !== normalizedPhrase) {
    const { data } = await supabase
      .from('interest_phrases')
      .select('topic_text')
      .eq('normalized_phrase', topicText)
      .eq('model', EMBEDDING_MODEL)
      .maybeSingle()
    if (data?.topic_text === topicText) return { p_copy_from: topicText }
  }
  const { embeddings } = await embed([topicText], 'query')
  return { p_embedding: toPgVector(embeddings[0]) }
}

async function topicWordSet(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from('topics').select('name')
  return new Set((data ?? []).flatMap((t) => normalizePhrase(t.name).split(' ')))
}

// §5.3 step 3, run outside the request. Uncertain answers keep parse_raw for the review list (§8).
export async function runHaikuParse(supabase: SupabaseClient, normalizedPhrase: string, displayPhrase: string) {
  let parseRaw: Record<string, unknown>
  let result = { topicText: normalizedPhrase, place: null as Place | null }
  try {
    const answer = await askHaikuForPlace(displayPhrase)
    parseRaw = { ...answer }
    result = validateHaikuParse(answer, normalizedPhrase, await loadGazetteer(supabase))
    if (answer.place && !result.place) {
      parseRaw.rejected = 'place not in gazetteer'
      console.warn(`Interest parse: Haiku named an unknown place for "${normalizedPhrase}":`, answer.place)
    }
  } catch (error) {
    parseRaw = { error: error instanceof Error ? error.message : String(error) }
    console.error(`Interest parse failed for "${normalizedPhrase}":`, error)
  }

  // The phrase was embedded whole; re-embed only if the topic changed
  const vector = result.topicText !== normalizedPhrase ? await topicEmbedding(supabase, result.topicText, normalizedPhrase) : {}
  const { error } = await supabase.rpc('complete_interest_parse', {
    p_phrase: normalizedPhrase,
    p_model: EMBEDDING_MODEL,
    p_topic_text: result.topicText,
    p_place_type: result.place?.type ?? null,
    p_place_id: result.place?.id ?? null,
    p_parse_method: result.place ? 'llm' : 'none',
    p_parse_raw: parseRaw,
    ...vector,
  })
  if (error) console.error(`Interest parse write failed for "${normalizedPhrase}":`, error.message)

  // The widget was ranked without the place; drop it so the next request re-ranks
  await supabase.from('widget_cache').delete().eq('widget_key', `interest:${normalizedPhrase}`)
}

export async function resolveInterest(
  supabase: SupabaseClient,
  phrase: string,
  options: {
    levels?: JurisdictionLevel[]
    itemCount?: number
    excludeTopicIds?: string[]
    // Runs the Haiku parse after the response (the route passes next/server `after`).
    // Without it, a phrase that needs the fallback stays pending.
    schedule?: ScheduleTask
  } = {}
): Promise<ResolvedInterest> {
  const displayPhrase = phrase.trim().replace(/\s+/g, ' ')
  const normalizedPhrase = normalizePhrase(phrase)
  if (!normalizedPhrase) throw new Error('Phrase is empty after normalization')

  const gazetteer = await loadGazetteer(supabase)

  // 1. Cache lookup (bumps hit_count on a hit)
  const { data: hitRows, error: hitError } = await supabase.rpc('interest_phrase_lookup', {
    p_phrase: normalizedPhrase,
    p_model: EMBEDDING_MODEL,
  })
  if (hitError) throw new Error(`Phrase cache lookup failed: ${hitError.message}`)
  let parse = (hitRows as CachedParse[] | null)?.[0] ?? null
  const cached = Boolean(parse)

  // 2–4. Miss: gazetteer split, then one query-side embedding of the topic
  if (!parse) {
    const detected = detectPlace(normalizedPhrase, gazetteer)
    const pending = !detected.place && looksLikePlace(displayPhrase, await topicWordSet(supabase))
    parse = {
      topic_text: detected.topicText,
      place_type: detected.place?.type ?? null,
      place_id: detected.place?.id ?? null,
      parse_method: detected.place ? 'gazetteer' : 'none',
      parse_pending: pending,
    }
    const { error } = await supabase.rpc('store_interest_phrase_parsed', {
      p_phrase: normalizedPhrase,
      p_model: EMBEDDING_MODEL,
      p_topic_text: parse.topic_text,
      p_place_type: parse.place_type,
      p_place_id: parse.place_id,
      p_parse_method: parse.parse_method,
      p_parse_pending: parse.parse_pending,
      ...(await topicEmbedding(supabase, parse.topic_text, normalizedPhrase)),
    })
    if (error) throw new Error(`Phrase cache write failed: ${error.message}`)
  }

  // 3. Async fallback: claim so concurrent requests queue one Haiku call between them
  if (parse.parse_pending && options.schedule) {
    const { data: claimed } = await supabase.rpc('claim_interest_parse', {
      p_phrase: normalizedPhrase,
      p_stale_seconds: PARSE_STALE_SECONDS,
    })
    if (claimed) options.schedule(() => runHaikuParse(supabase, normalizedPhrase, displayPhrase))
  }

  const place = parse.place_type ? (gazetteer.byKey.get(`${parse.place_type}:${parse.place_id}`) ?? null) : null

  // 6. The shared interest widget: the precomputed one if it exists (refreshed
  // every 15 minutes while anyone uses it), otherwise ranked once here and cached (§6.1)
  const widgetKey = `interest:${normalizedPhrase}`
  const excluded = new Set(options.excludeTopicIds ?? [])
  const [cachedWidget, topics] = await Promise.all([
    supabase.from('widget_cache').select('items, config_version').eq('widget_key', widgetKey).maybeSingle(),
    // 7. Related-topic suggestions
    supabase.rpc('match_phrase_topics', {
      p_phrase: normalizedPhrase,
      p_model: EMBEDDING_MODEL,
      p_count: TOPIC_SUGGESTION_COUNT + excluded.size,
      p_min_similarity: TOPIC_SUGGESTION_FLOOR,
    }),
  ])
  if (cachedWidget.error) throw new Error(`Widget cache read failed: ${cachedWidget.error.message}`)
  if (topics.error) throw new Error(`Topic match failed: ${topics.error.message}`)

  const requestedAt = new Date()
  let widgetItems: WidgetItem[]
  let configVersion: number
  if (cachedWidget.data) {
    widgetItems = cachedWidget.data.items as WidgetItem[]
    configVersion = cachedWidget.data.config_version
    await supabase.from('widget_cache').update({ last_requested_at: requestedAt.toISOString() }).eq('widget_key', widgetKey)
  } else {
    const config = await loadRankingConfig(supabase, CONFIG_MAX_AGE_MS)
    const placeRef = parse.place_type ? { type: parse.place_type, id: parse.place_id! } : null
    widgetItems = await rankInterestWidget(supabase, normalizedPhrase, placeRef, config, requestedAt)
    configVersion = config.version
    const { error } = await supabase.from('widget_cache').upsert({
      widget_key: widgetKey,
      items: widgetItems,
      config_version: config.version,
      computed_at: requestedAt.toISOString(),
      last_requested_at: requestedAt.toISOString(),
    })
    if (error) throw new Error(`Widget cache write failed: ${error.message}`)
  }

  const levels = options.levels?.length ? new Set<string>(options.levels) : null
  return {
    widgetKey,
    displayPhrase,
    normalizedPhrase,
    topicText: parse.topic_text,
    place,
    comingSoon: place ? !place.covered : false,
    parsePending: parse.parse_pending,
    cached,
    model: EMBEDDING_MODEL,
    configVersion,
    items: widgetItems
      .filter((i) => !levels || levels.has(i.jurisdictionLevel))
      .slice(0, options.itemCount ?? DEFAULT_ITEM_COUNT),
    relatedTopics: pickTopicSuggestions((topics.data ?? []) as TopicSuggestion[], excluded),
  }
}

// Expects topics sorted by similarity, best first
export function pickTopicSuggestions(topics: TopicSuggestion[], excluded: Set<string> = new Set()): TopicSuggestion[] {
  if (topics.length === 0) return []
  const cutoff = topics[0].similarity - TOPIC_SUGGESTION_MARGIN
  return topics
    .filter((t) => t.similarity >= cutoff && !excluded.has(t.id))
    .slice(0, TOPIC_SUGGESTION_COUNT)
}
