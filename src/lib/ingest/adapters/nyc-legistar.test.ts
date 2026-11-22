import { describe, expect, it } from 'vitest'
import { classify, mapStage, parseCouncilDistricts, toContentItem, type LegistarContentRow } from './nyc-legistar'
import { resolveItem } from '../run'

const NOW = new Date('2026-11-20T12:00:00Z')

function row(overrides: Partial<LegistarContentRow> = {}): LegistarContentRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'int-0123-2026',
    file_number: 'Int 0123-2026',
    title: 'A Local Law to amend the administrative code, in relation to bus lanes',
    status: 'Committee',
    type: 'introduction',
    intro_date: '2026-03-01',
    last_action_date: '2026-04-01',
    ai_summary: 'Adds protected bus lanes on key corridors.',
    official_summary: 'This bill would require DOT to…',
    legistar_url: 'https://legistar.council.nyc.gov/gateway.aspx?m=l&id=9999',
    sponsorships: [
      { is_primary: true, legislators: { legistar_id: 101, district: '39' } },
      { is_primary: false, legislators: { legistar_id: 202, district: '33' } },
    ],
    legislation_topics: [{ topics: { slug: 'transportation' } }],
    legislation_history: [{ action_date: '2026-05-10' }],
    events: [],
    ...overrides,
  }
}

describe('classify', () => {
  it('maps intros and resolutions by type', () => {
    expect(classify(row())).toBe('bill')
    expect(classify(row({ type: 'resolution', file_number: 'Res 0042-2026' }))).toBe('resolution')
  })

  it('maps Land Use and Oversight items by file number', () => {
    expect(classify(row({ type: null, file_number: 'LU 0159-2026' }))).toBe('project')
    expect(classify(row({ type: null, file_number: 'T2026-2818', title: 'Oversight - The Future of Hunts Point.' }))).toBe('hearing')
  })

  it('skips mayoral communications, SLRs and non-oversight T-items', () => {
    expect(classify(row({ type: null, file_number: 'M 0012-2026' }))).toBeNull()
    expect(classify(row({ type: null, file_number: 'SLR 0003-2026' }))).toBeNull()
    expect(classify(row({ type: null, file_number: 'T2026-0001', title: 'Tour - Hunts Point Market.' }))).toBeNull()
  })
})

describe('mapStage', () => {
  it('maps statuses to stages', () => {
    expect(mapStage('Introduced', false)).toBe('introduced')
    expect(mapStage('Laid Over in Committee', false)).toBe('in_committee')
    expect(mapStage('General Orders Calendar', false)).toBe('passed_committee')
    expect(mapStage("Enacted (Mayor's Desk for Signature)", false)).toBe('passed_chamber')
    expect(mapStage('Adopted', false)).toBe('enacted')
    expect(mapStage('Disapproved', false)).toBe('vetoed')
    expect(mapStage('Filed (End of Session)', false)).toBe('dead')
  })

  it('upgrades introduced/in-committee items with an upcoming event to hearing_scheduled', () => {
    expect(mapStage('Committee', true)).toBe('hearing_scheduled')
    expect(mapStage('Introduced', true)).toBe('hearing_scheduled')
    expect(mapStage('Enacted', true)).toBe('enacted')
  })

  it('returns undefined for unknown statuses', () => {
    expect(mapStage('Something New', false)).toBeUndefined()
  })
})

describe('parseCouncilDistricts', () => {
  it('parses single and multiple districts', () => {
    expect(parseCouncilDistricts('…Manhattan, Community District 12, Council District 10.')).toEqual(['10'])
    expect(parseCouncilDistricts('…Bronx, Community Districts 5 and 7, Council Districts 14 and 15.')).toEqual(['14', '15'])
    expect(parseCouncilDistricts('Council Districts 1, 2 & 3')).toEqual(['1', '2', '3'])
  })

  it('ignores community districts, out-of-range numbers and missing districts', () => {
    expect(parseCouncilDistricts('Community District 5')).toEqual([])
    expect(parseCouncilDistricts('Council District 99')).toEqual([])
    expect(parseCouncilDistricts('Application number C 260193 HAX')).toEqual([])
  })
})

describe('toContentItem', () => {
  it('normalizes a bill', () => {
    expect(toContentItem(row(), NOW)).toEqual({
      externalId: 'Int 0123-2026',
      itemType: 'bill',
      title: 'A Local Law to amend the administrative code, in relation to bus lanes',
      summary: 'Adds protected bus lanes on key corridors.',
      url: 'https://legistar.council.nyc.gov/gateway.aspx?m=l&id=9999',
      jurisdictionLevel: 'city',
      legislatureSlug: 'nyc-council',
      stage: 'in_committee',
      statusRaw: 'Committee',
      introducedAt: '2026-03-01',
      lastActivityAt: '2026-05-10',
      nextEventAt: undefined,
      isDead: false,
      places: [
        { type: 'city', id: 'nyc' },
        { type: 'council_district', id: '39' },
      ],
      people: [
        { legislatorExternalId: '101', role: 'primary_sponsor' },
        { legislatorExternalId: '202', role: 'sponsor' },
      ],
      topicSlugs: ['transportation'],
      metadata: { file_number: 'Int 0123-2026', slug: 'int-0123-2026' },
      legislationId: '11111111-1111-1111-1111-111111111111',
    })
  })

  it('falls back to the official summary, and to null when both are blank', () => {
    expect(toContentItem(row({ ai_summary: null }), NOW)?.summary).toBe('This bill would require DOT to…')
    expect(toContentItem(row({ ai_summary: ' ', official_summary: '' }), NOW)?.summary).toBeNull()
  })

  it('sets next_event_at and hearing_scheduled from the earliest future event', () => {
    const item = toContentItem(
      row({ events: [{ event_date: '2026-12-03T10:00:00Z' }, { event_date: '2026-11-25T10:00:00Z' }, { event_date: '2026-11-01T10:00:00Z' }] }),
      NOW
    )
    expect(item?.nextEventAt).toBe('2026-11-25T10:00:00Z')
    expect(item?.stage).toBe('hearing_scheduled')
  })

  it('marks filed items dead', () => {
    const item = toContentItem(row({ status: 'Filed (End of Session)' }), NOW)
    expect(item?.stage).toBe('dead')
    expect(item?.isDead).toBe(true)
  })

  it('omits the district place when the primary sponsor has no district', () => {
    const item = toContentItem(row({ sponsorships: [{ is_primary: true, legislators: { legistar_id: 7, district: null } }] }), NOW)
    expect(item?.places).toEqual([{ type: 'city', id: 'nyc' }])
  })

  it('puts Land Use items in the neighborhood level with title districts and no people', () => {
    const item = toContentItem(
      row({
        type: null,
        file_number: 'LU 0159-2026',
        title: 'Fordham Bedford Cluster Phase 3: Block 3197, Lot 23, Bronx, Community Districts 5 and 7, Council Districts 14 and 15.',
        status: 'Adopted',
        sponsorships: [{ is_primary: true, legislators: { legistar_id: 303, district: '23' } }],
      }),
      NOW
    )
    expect(item?.itemType).toBe('project')
    expect(item?.jurisdictionLevel).toBe('neighborhood')
    expect(item?.places).toEqual([
      { type: 'council_district', id: '14' },
      { type: 'council_district', id: '15' },
    ])
    expect(item?.people).toEqual([])
  })

  it('skips rows without a Legistar URL or any activity date', () => {
    expect(toContentItem(row({ legistar_url: null }), NOW)).toBeNull()
    expect(toContentItem(row({ intro_date: null, last_action_date: null, legislation_history: [] }), NOW)).toBeNull()
  })
})

describe('resolveItem', () => {
  const lookups = {
    legislatureIdBySlug: new Map([['nyc-council', 'leg-1']]),
    legislatorIdByExternalId: new Map([['101', 'person-101']]),
    topicIdByKey: new Map([['leg-1:transportation', 'topic-t']]),
  }

  it('resolves IDs and counts misses', () => {
    const { row: resolved, unresolvedPeople, unresolvedTopics } = resolveItem(toContentItem(row(), NOW)!, lookups)
    expect(resolved.legislature_id).toBe('leg-1')
    expect(resolved.people).toEqual([{ legislator_id: 'person-101', role: 'primary_sponsor' }])
    expect(resolved.topic_ids).toEqual(['topic-t'])
    expect(unresolvedPeople).toBe(1)
    expect(unresolvedTopics).toBe(0)
  })

  it('produces a stable ingest hash that changes with content', () => {
    const a = resolveItem(toContentItem(row(), NOW)!, lookups).row
    const b = resolveItem(toContentItem(row(), NOW)!, lookups).row
    const c = resolveItem(toContentItem(row({ ai_summary: 'Changed.' }), NOW)!, lookups).row
    expect(a.ingest_hash).toBe(b.ingest_hash)
    expect(c.ingest_hash).not.toBe(a.ingest_hash)
    expect(c.content_hash).not.toBe(a.content_hash)
  })
})
