import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhrase } from './normalize'

// Places inside typed interests (recommendations-planv1.2.md §5.3 steps 2–3, D26).
// The gazetteer match is instant and runs in the request; the Haiku fallback never does.

export type PlaceType = 'federal' | 'state' | 'city' | 'borough' | 'council_district' | 'neighborhood' | 'area'

export interface Place {
  type: PlaceType
  id: string
  name: string
  covered: boolean // false → the widget shows "Coming soon"
}

export interface Gazetteer {
  // Longest alias first, so "washington heights" beats "washington"
  entries: { alias: string; place: Place }[]
  byAlias: Map<string, Place>
  byKey: Map<string, Place> // "type:id"
}

export interface PlaceParse {
  topicText: string // normalized
  place: Place | null
}

// Connector words dropped along with the place: "housing in california" → "housing"
const CONNECTORS = new Set(['in', 'for', 'around', 'near'])
const GAZETTEER_TTL_MS = 60 * 60 * 1000

let cached: { at: number; gazetteer: Gazetteer } | null = null

export function buildGazetteer(
  rows: { place_type: string; place_id: string; name: string; aliases: string[]; covered: boolean }[]
): Gazetteer {
  const byAlias = new Map<string, Place>()
  const byKey = new Map<string, Place>()
  for (const row of rows) {
    const place: Place = { type: row.place_type as PlaceType, id: row.place_id, name: row.name, covered: row.covered }
    byKey.set(`${place.type}:${place.id}`, place)
    for (const alias of new Set([normalizePhrase(row.name), ...row.aliases])) {
      // First writer wins; the seed keeps aliases unique, so this only guards hand edits
      if (alias && !byAlias.has(alias)) byAlias.set(alias, place)
    }
  }
  const entries = [...byAlias].map(([alias, place]) => ({ alias, place }))
  entries.sort((a, b) => b.alias.length - a.alias.length)
  return { entries, byAlias, byKey }
}

export async function loadGazetteer(supabase: SupabaseClient): Promise<Gazetteer> {
  if (cached && Date.now() - cached.at < GAZETTEER_TTL_MS) return cached.gazetteer
  const { data, error } = await supabase.from('places').select('place_type, place_id, name, aliases, covered')
  if (error) throw new Error(`Places load failed: ${error.message}`)
  cached = { at: Date.now(), gazetteer: buildGazetteer(data ?? []) }
  return cached.gazetteer
}

// Step 2: longest alias match on word boundaries, then strip it and its connector.
// A phrase that is only a place keeps the whole phrase as its topic.
export function detectPlace(normalizedPhrase: string, gazetteer: Gazetteer): PlaceParse {
  const padded = ` ${normalizedPhrase} `
  for (const { alias, place } of gazetteer.entries) {
    const at = padded.indexOf(` ${alias} `)
    if (at === -1) continue

    const before = padded.slice(0, at).trim().split(' ').filter(Boolean)
    const after = padded.slice(at + alias.length + 2).trim().split(' ').filter(Boolean)
    if (before.length && CONNECTORS.has(before[before.length - 1])) before.pop()
    if (after[0] === 's') after.shift() // "nyc's" normalizes to "nyc s"

    const topicText = [...before, ...after].join(' ')
    return { topicText: topicText || normalizedPhrase, place }
  }
  return { topicText: normalizedPhrase, place: null }
}

// Step 3 trigger: no gazetteer match, but the phrase seems to name a place —
// "in/near/around + word", or a capitalized word after the first that isn't a topic word.
export function looksLikePlace(displayPhrase: string, topicWords: Set<string>): boolean {
  if (/\b(in|near|around)\s+\p{L}/iu.test(displayPhrase)) return true
  const words = displayPhrase.split(/\s+/).slice(1)
  return words.some((w) => /^\p{Lu}/u.test(w) && !topicWords.has(normalizePhrase(w)))
}

export interface HaikuParse {
  topic: string | null
  place: string | null
}

const PARSE_MODEL = 'claude-haiku-4-5-20251001'

// One Haiku call; the answer is only trusted after the gazetteer confirms the place.
export async function askHaikuForPlace(displayPhrase: string, client = new Anthropic()): Promise<HaikuParse> {
  const message = await client.messages.create({
    model: PARSE_MODEL,
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `A user typed this interest into a civic app that tracks legislation: "${displayPhrase}"

If it names a geographic place (a US state, city, borough or neighborhood), split it into the topic and the place. Use the place's common name. If no place is named, place is null.

Respond with valid JSON only:
{"topic":"...","place":"..." or null}`,
      },
    ],
  })

  const block = message.content[0]
  if (block?.type !== 'text') return { topic: null, place: null }
  const raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsed = JSON.parse(raw)
  return {
    topic: typeof parsed.topic === 'string' ? parsed.topic : null,
    place: typeof parsed.place === 'string' ? parsed.place : null,
  }
}

// The fallback can't invent places: its place must be a gazetteer name or alias
export function validateHaikuParse(parse: HaikuParse, normalizedPhrase: string, gazetteer: Gazetteer): PlaceParse {
  const place = parse.place ? (gazetteer.byAlias.get(normalizePhrase(parse.place)) ?? null) : null
  if (!place) return { topicText: normalizedPhrase, place: null }
  const topicText = parse.topic ? normalizePhrase(parse.topic) : ''
  return { topicText: topicText || normalizedPhrase, place }
}
