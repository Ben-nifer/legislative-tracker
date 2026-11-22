import { describe, expect, it } from 'vitest'
import {
  DOT_DATASET_URL,
  createNycLocalProposalsAdapter,
  mapStage,
  neighborhoodPlaces,
  toContentItem,
  type LocalProposalRow,
} from './nyc-local-proposals'
import { resolveItem } from '../run'
import type { SupabaseClient } from '@supabase/supabase-js'

const NOW = new Date('2026-11-20T12:00:00Z')

// Shaped like real rows from local_proposal_rows() (live DB, 2026-11-22)
function ulurp(overrides: Partial<LocalProposalRow> = {}): LocalProposalRow {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    source: 'zap_ulurp',
    source_id: '2025Q0142',
    proposal_family: 'ulurp',
    proposal_type: 'ulurp_rezoning_area',
    geometry_type: 'point',
    geometry_precise: true,
    community_districts: ['queens-cd-4'],
    title: '47-03 108th Street Rezoning',
    description: 'A zoning map amendment from R6B to R7X/C2-4 and zoning text amendment to map MIH Option 1…',
    ai_summary: 'A developer wants to build a 13-story apartment building in Corona, Queens with 119 apartments.',
    status: 'In Public Review',
    borough: 'Queens',
    lead_agency: 'DCP',
    slug: 'ulurp-2025q0142',
    source_url: 'https://zap.planning.nyc.gov/projects/2025Q0142',
    filed_date: '2025-11-05',
    last_action_date: '2026-06-30',
    created_at: '2026-11-01T22:00:00+00:00',
    nta_codes: ['QN0302'],
    latest_milestone_date: '2026-06-17',
    latest_milestone_text: 'ZM - Review Session - Post Hearing Follow-Up / Future Votes',
    ulurp: {
      actions: 'ZM; ZR',
      review_type: 'ULURP',
      cc_district: '21',
      applicant_name: null,
      applicant_type: null,
      ceqr_number: null,
      mih: true,
    },
    dot: null,
    ...overrides,
  }
}

function dot(overrides: Partial<LocalProposalRow> = {}): LocalProposalRow {
  return {
    ...ulurp(),
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    source: 'dot_capital',
    source_id: '2433',
    proposal_family: 'dot',
    proposal_type: 'dot_street_redesign',
    geometry_type: 'line',
    geometry_precise: false, // every DOT row in the live DB (column default)
    community_districts: ['queens-cd-9'],
    title: '82 AVENUE from 126 STREET to 132 STREET',
    description: 'CAPITAL RECONSTRUCTION',
    ai_summary: null,
    status: 'Completed Project',
    borough: 'QUEENS',
    lead_agency: 'DOT',
    slug: 'dot-2433',
    source_url: null,
    filed_date: null,
    last_action_date: '2017-01-01',
    nta_codes: ['QN0901', 'QN0902'],
    latest_milestone_date: null,
    latest_milestone_text: null,
    ulurp: null,
    dot: {
      project_type: 'CAPITAL RECONSTRUCTION',
      on_street: '82 AVENUE',
      from_street: '126 STREET',
      to_street: '132 STREET',
      construction_fy: '2017',
      project_cost: null,
    },
    ...overrides,
  }
}

describe('mapStage', () => {
  it('maps every ZAP and DOT status in the live data', () => {
    expect(mapStage('Filed')).toBe('introduced')
    expect(mapStage('Noticed')).toBe('introduced')
    expect(mapStage('In Public Review')).toBe('in_committee')
    expect(mapStage('Completed')).toBe('enacted')
    expect(mapStage('Completed Project')).toBe('enacted')
    expect(mapStage('Substantial Completion')).toBe('enacted')
    expect(mapStage('Final Completion')).toBe('enacted')
  })

  it('returns undefined for unknown statuses', () => {
    expect(mapStage('Unknown')).toBeUndefined()
  })
})

describe('neighborhoodPlaces', () => {
  it('tags precise geometry to every NTA it intersects, deduped and sorted', () => {
    expect(neighborhoodPlaces({ geometry_precise: true, nta_codes: ['BK0602', 'BK0601', 'BK0602'] })).toEqual([
      { type: 'neighborhood', id: 'BK0601' },
      { type: 'neighborhood', id: 'BK0602' },
    ])
  })

  it('leaves imprecise (district-centroid) geometry untagged', () => {
    expect(neighborhoodPlaces({ geometry_precise: false, nta_codes: ['QN0302'] })).toEqual([])
  })

  it('handles geometry that hits no NTA (water, parks)', () => {
    expect(neighborhoodPlaces({ geometry_precise: true, nta_codes: [] })).toEqual([])
  })
})

describe('toContentItem', () => {
  it('maps a precise ULURP proposal per build plan §4.8', () => {
    const item = toContentItem(ulurp(), NOW)!
    expect(item).toMatchObject({
      externalId: 'zap_ulurp:2025Q0142',
      itemType: 'project',
      title: '47-03 108th Street Rezoning',
      summary: 'A developer wants to build a 13-story apartment building in Corona, Queens with 119 apartments.',
      url: 'https://zap.planning.nyc.gov/projects/2025Q0142',
      jurisdictionLevel: 'neighborhood',
      stage: 'in_committee',
      statusRaw: 'In Public Review',
      introducedAt: '2025-11-05',
      lastActivityAt: '2026-06-30',
      isDead: false,
      places: [{ type: 'neighborhood', id: 'QN0302' }],
      people: [],
    })
    expect(item.legislatureSlug).toBeUndefined()
    expect(item.metadata).toMatchObject({
      subtype: 'ulurp_rezoning_area',
      family: 'ulurp',
      slug: 'ulurp-2025q0142',
      geometry_precise: true,
      community_districts: ['queens-cd-4'],
      ulurp: { actions: 'ZM; ZR', cc_district: '21', mih: true },
    })
  })

  it('falls back to the description when there is no AI summary', () => {
    expect(toContentItem(ulurp({ ai_summary: '  ' }), NOW)!.summary).toMatch(/^A zoning map amendment/)
    expect(toContentItem(ulurp({ ai_summary: null, description: null }), NOW)!.summary).toBeNull()
  })

  it('keeps imprecise proposals as items but without neighborhood tags', () => {
    const item = toContentItem(ulurp({ geometry_precise: false }), NOW)!
    expect(item.places).toEqual([])
    expect(item.jurisdictionLevel).toBe('neighborhood')
  })

  it('maps a DOT project, linking to the dataset when the row has no URL', () => {
    const item = toContentItem(dot(), NOW)!
    expect(item).toMatchObject({
      externalId: 'dot_capital:2433',
      itemType: 'project',
      url: DOT_DATASET_URL,
      summary: 'CAPITAL RECONSTRUCTION',
      stage: 'enacted',
      lastActivityAt: '2017-01-01',
      places: [], // geometry_precise is false on every DOT row today
    })
    expect(item.introducedAt).toBeUndefined()
    expect(item.metadata).toMatchObject({ subtype: 'dot_street_redesign', dot: { on_street: '82 AVENUE' } })
  })

  it('tags a corridor to several NTAs once its geometry is precise', () => {
    expect(toContentItem(dot({ geometry_precise: true }), NOW)!.places).toEqual([
      { type: 'neighborhood', id: 'QN0901' },
      { type: 'neighborhood', id: 'QN0902' },
    ])
  })

  it('uses the latest past date as last activity, ignoring future dates', () => {
    expect(toContentItem(ulurp({ latest_milestone_date: '2026-07-15' }), NOW)!.lastActivityAt).toBe('2026-07-15')
    expect(toContentItem(ulurp({ last_action_date: '2027-01-01' }), NOW)!.lastActivityAt).toBe('2026-06-17')
  })

  it('falls back to created_at when no date has passed', () => {
    const item = toContentItem(
      ulurp({ last_action_date: null, latest_milestone_date: null, filed_date: '2027-02-01' }),
      NOW
    )!
    expect(item.lastActivityAt).toBe('2026-11-01T22:00:00+00:00')
  })

  it('skips rows with no title, no usable URL, or no date at all', () => {
    expect(toContentItem(ulurp({ title: ' ' }), NOW)).toBeNull()
    expect(toContentItem(ulurp({ source_url: null }), NOW)).toBeNull()
    expect(
      toContentItem(
        ulurp({ last_action_date: null, latest_milestone_date: null, filed_date: null, created_at: null }),
        NOW
      )
    ).toBeNull()
  })

  it('leaves the stage unset for an unknown status, and the item live', () => {
    const item = toContentItem(ulurp({ status: 'Unknown' }), NOW)!
    expect(item.stage).toBeUndefined()
    expect(item.isDead).toBe(false)
  })

  it('resolves through the shared runner with neighborhood places and no legislature', () => {
    const lookups = { legislatureIdBySlug: new Map([['nyc-council', 'L1']]), legislatorIdByExternalId: new Map(), topicIdByKey: new Map() }
    const { row, unresolvedPeople, unresolvedTopics } = resolveItem(toContentItem(ulurp(), NOW)!, lookups)
    expect(row).toMatchObject({
      external_id: 'zap_ulurp:2025Q0142',
      jurisdiction_level: 'neighborhood',
      legislature_id: null,
      legislation_id: null,
      places: [{ type: 'neighborhood', id: 'QN0302' }],
      people: [],
      topic_ids: [],
    })
    expect(unresolvedPeople + unresolvedTopics).toBe(0)
    // Same input, same hash: re-runs write nothing
    expect(resolveItem(toContentItem(ulurp(), NOW)!, lookups).row.ingest_hash).toBe(row.ingest_hash)
  })
})

describe('createNycLocalProposalsAdapter', () => {
  it('pages through local_proposal_rows by id', async () => {
    const pages = [
      Array.from({ length: 500 }, (_, i) => ulurp({ id: `id-${String(i).padStart(4, '0')}` })),
      [ulurp({ id: 'id-0500' })],
    ]
    const calls: unknown[] = []
    const supabase = {
      from: () => ({ select: () => ({ not: async () => ({ data: [], error: null }) }) }),
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args })
        return { data: pages[calls.length - 1] ?? [], error: null }
      },
    } as unknown as SupabaseClient

    const adapter = createNycLocalProposalsAdapter(supabase)
    expect(adapter.slug).toBe('nyc-local-proposals')
    expect(adapter.fullScan).toBe(true)
    const ids: string[] = []
    for await (const row of adapter.fetchChanged(null)) ids.push(row.id)
    expect(ids).toHaveLength(501)
    expect(calls).toEqual([
      { fn: 'local_proposal_rows', args: { p_after: null, p_limit: 500 } },
      { fn: 'local_proposal_rows', args: { p_after: 'id-0499', p_limit: 500 } },
    ])
  })

  it('throws on a read error rather than emitting a partial catalog', async () => {
    const supabase = {
      from: () => ({ select: () => ({ not: async () => ({ data: [], error: null }) }) }),
      rpc: async () => ({ data: null, error: { message: 'boom' } }),
    } as unknown as SupabaseClient
    const iterate = async () => {
      for await (const _row of createNycLocalProposalsAdapter(supabase).fetchChanged(null)) void _row
    }
    await expect(iterate()).rejects.toThrow(/boom/)
  })
})

describe('linked proposals', () => {
  it('folds a ZAP proposal linked to a Land Use item, whatever its P prefix', () => {
    const linked = new Set(['2022X0393'])
    expect(toContentItem(ulurp({ source_id: 'P2022X0393' }), NOW, linked)).toBeNull()
    expect(toContentItem(ulurp({ source_id: '2022X0393' }), NOW, linked)).toBeNull()
    expect(toContentItem(ulurp({ source_id: '2024M0243' }), NOW, linked)).not.toBeNull()
  })
})
