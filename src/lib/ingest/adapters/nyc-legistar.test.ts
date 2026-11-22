import { describe, expect, it } from 'vitest'
import {
  buildJointHearings,
  buildLandUseDecisions,
  buildMayoralActors,
  classify,
  decisionOutcome,
  emptyContext,
  isLandUseResolution,
  isMayoralAction,
  linkedLandUseFile,
  mapStage,
  parseCouncilDistricts,
  toContentItem,
  type LegistarContentRow,
} from './nyc-legistar'
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
    created_at: '2026-02-20T15:00:00+00:00',
    sponsorships: [
      { is_primary: true, legislators: { legistar_id: 101, district: '39' } },
      { is_primary: false, legislators: { legistar_id: 202, district: '33' } },
    ],
    committee_id: null,
    committees: { name: 'Committee on Transportation and Infrastructure' },
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

  it('skips T-numbered Intros and Resolutions (pre-filing duplicates of the Int/Res)', () => {
    expect(classify(row({ type: 'introduction', file_number: 'T2026-2298' }))).toBeNull()
    expect(classify(row({ type: 'resolution', file_number: 'T2026-2641' }))).toBeNull()
  })
})

describe('Land Use resolutions', () => {
  const approval = row({
    type: 'resolution',
    file_number: 'Res 0712-2026',
    title: 'Resolution approving the decision of the City Planning Commission on ULURP No. N 220450 ZRK (L.U. No. 143).',
    committees: { name: 'Committee on Land Use' },
    status: 'Adopted',
    sponsorships: [{ is_primary: true, legislators: { legistar_id: 999, district: '18' } }],
  })

  it('recognizes the committee\'s application decisions, not its policy resolutions', () => {
    expect(isLandUseResolution(approval)).toBe(true)
    expect(isLandUseResolution({ ...approval, committees: { name: 'Subcommittee on Zoning and Franchises' } })).toBe(true)
    expect(isLandUseResolution({ ...approval, title: 'Resolution calling on the Governor to sign S.1234.' })).toBe(false)
    expect(isLandUseResolution({ ...approval, committees: { name: 'Committee on Finance' } })).toBe(false)
  })

  it('links "(L.U. No. 143)" to the LU item of the same year', () => {
    expect(linkedLandUseFile(approval)).toBe('LU 0143-2026')
    expect(linkedLandUseFile({ ...approval, title: 'Resolution approving the site plan.' })).toBeNull()
  })

  const luTitle = '1455 Coney Island Avenue Rezoning, Brooklyn, Community District 14, Council District 44.'
  const ctx = () => {
    const c = emptyContext()
    c.landUseTitles.set('LU 0143-2026', luTitle)
    c.landUseDecisions = buildLandUseDecisions([approval], c.landUseTitles)
    return c
  }

  it('is folded into the LU item it decides', () => {
    expect(toContentItem(approval, NOW, ctx())).toBeNull()
  })

  it('puts the decision on the LU item and counts its date as activity', () => {
    const lu = row({
      type: null,
      file_number: 'LU 0143-2026',
      title: luTitle,
      status: 'Adopted',
      last_action_date: '2026-10-01',
      legislation_history: [{ action_date: '2026-10-01' }],
    })
    const item = toContentItem(lu, NOW, ctx())
    expect(item?.itemType).toBe('project')
    expect(item?.metadata?.council_decision).toEqual({
      fileNumber: 'Res 0712-2026',
      outcome: 'approved',
      status: 'Adopted',
      date: '2026-04-01',
      url: approval.legistar_url,
    })
    expect(item?.lastActivityAt).toBe('2026-10-01') // decision older than the LU's own history
  })

  it('stays a neighborhood item crediting no one when it links to no LU item', () => {
    const item = toContentItem({ ...approval, title: 'Resolution approving the site plan, Council District 12.' }, NOW, ctx())
    expect(item?.itemType).toBe('resolution')
    expect(item?.jurisdictionLevel).toBe('neighborhood')
    expect(item?.places).toEqual([{ type: 'council_district', id: '12' }])
    expect(item?.people).toEqual([])
  })

  it('reads the outcome from the resolution title', () => {
    expect(decisionOutcome('Resolution approving with modifications the decision of …')).toBe('approved_with_modifications')
    expect(decisionOutcome('Resolution disapproving the decision of …')).toBe('disapproved')
    expect(decisionOutcome('Resolution affirming the designation by …')).toBe('affirmed')
    expect(decisionOutcome('Resolution approving the decision of …')).toBe('approved')
  })

  it('keeps sponsors and citywide placement for policy resolutions in that committee', () => {
    const item = toContentItem({ ...approval, title: 'Resolution calling on the Governor to sign S.1234.' }, NOW)
    expect(item?.jurisdictionLevel).toBe('city')
    expect(item?.people).toEqual([{ legislatorExternalId: '999', role: 'primary_sponsor' }])
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

describe('joint hearings', () => {
  const hearing = (file_number: string, committee: string, intro_date = '2026-12-16') =>
    row({
      type: null,
      file_number,
      title: 'Oversight -  Addressing New York City’s Aging Homeless Population.',
      intro_date,
      committees: { name: committee },
      sponsorships: [],
    })
  const rows = [
    hearing('T2026-2742', 'Committee on Aging'),
    hearing('T2026-2741', 'Committee on General Welfare'),
    hearing('T2026-0100', 'Committee on Aging', '2026-03-02'), // same title, another day
  ]
  const ctx = { ...emptyContext(), jointHearings: buildJointHearings(rows) }

  it('emits one item per joint hearing, listing every committee', () => {
    const item = toContentItem(rows[1], NOW, ctx)
    expect(item?.externalId).toBe('T2026-2741')
    expect(item?.metadata?.committees).toEqual(['Committee on Aging', 'Committee on General Welfare'])
    expect(item?.metadata?.joint_file_numbers).toEqual(['T2026-2741', 'T2026-2742'])
    expect(toContentItem(rows[0], NOW, ctx)).toBeNull()
  })

  it('keeps same-title hearings on different days separate', () => {
    const item = toContentItem(rows[2], NOW, ctx)
    expect(item?.externalId).toBe('T2026-0100')
    expect(item?.metadata?.committees).toEqual(['Committee on Aging'])
    expect(item?.metadata?.joint_file_numbers).toBeUndefined()
  })
})

describe('hearing dates', () => {
  const oversight = (date: string) =>
    row({
      type: null,
      file_number: 'T2026-2748',
      title: 'Oversight - The Future of Hunts Point.',
      status: 'Committee',
      intro_date: date,
      last_action_date: date,
      created_at: '2026-11-04T18:01:09+00:00',
      legislation_history: [],
      sponsorships: [],
    })

  it('makes an upcoming hearing date next_event_at, with activity from when it was first seen', () => {
    const item = toContentItem(oversight('2026-11-24'), NOW)
    expect(item?.nextEventAt).toBe('2026-11-24T17:00:00Z')
    expect(item?.lastActivityAt).toBe('2026-11-04T18:01:09+00:00')
    expect(item?.stage).toBe('hearing_scheduled')
  })

  it('treats a hearing later today as upcoming', () => {
    expect(toContentItem(oversight('2026-11-20'), NOW)?.nextEventAt).toBe('2026-11-20T17:00:00Z')
  })

  it('makes a past hearing date the last activity', () => {
    const item = toContentItem(oversight('2026-10-01'), NOW)
    expect(item?.nextEventAt).toBeUndefined()
    expect(item?.lastActivityAt).toBe('2026-10-01')
    expect(item?.stage).toBe('in_committee')
  })

  it('never puts last activity in the future for other items either', () => {
    const item = toContentItem(row({ intro_date: '2026-12-01', last_action_date: '2026-12-01', legislation_history: [] }), NOW)
    expect(item?.lastActivityAt).toBe('2026-02-20T15:00:00+00:00')
  })
})

describe('mayoral actors', () => {
  const mayors = [
    { externalId: 'manual:zohran-mamdani', termStart: '2026-01-01' },
    { externalId: 'manual:previous-mayor', termStart: '2022-01-01' },
  ]
  const id = '11111111-1111-1111-1111-111111111111'

  it('recognizes actions the Mayor takes, not ones sent to them', () => {
    expect(isMayoralAction('Returned Unsigned by Mayor')).toBe(true)
    expect(isMayoralAction('Vetoed by Mayor')).toBe(true)
    expect(isMayoralAction('Hearing Held by Mayor')).toBe(true)
    expect(isMayoralAction('Sent to Mayor by Council')).toBe(false)
    expect(isMayoralAction('Hearing Scheduled by Mayor Cancelled')).toBe(false)
  })

  it('credits each action to the mayor in office on that date', () => {
    const actors = buildMayoralActors(
      [
        { legislation_id: id, action_date: '2026-03-02', action_text: 'Returned Unsigned by Mayor' },
        { legislation_id: id, action_date: '2026-03-02', action_text: 'Hearing Held by Mayor' },
        { legislation_id: 'old', action_date: '2025-07-01', action_text: 'Signed Into Law by Mayor' },
        { legislation_id: 'sent', action_date: '2026-02-01', action_text: 'Sent to Mayor by Council' },
      ],
      mayors
    )
    expect(actors.get(id)).toEqual(['manual:zohran-mamdani'])
    expect(actors.get('old')).toEqual(['manual:previous-mayor'])
    expect(actors.has('sent')).toBe(false)
  })

  it('ignores actions before any recorded term', () => {
    const actors = buildMayoralActors(
      [{ legislation_id: id, action_date: '2025-12-30', action_text: 'Vetoed by Mayor' }],
      [mayors[0]]
    )
    expect(actors.size).toBe(0)
  })

  it('attaches the Mayor as an actor alongside the sponsors', () => {
    const ctx = { ...emptyContext(), mayoralActors: new Map([[id, ['manual:zohran-mamdani']]]) }
    const item = toContentItem(row(), NOW, ctx)
    expect(item?.people).toEqual([
      { legislatorExternalId: '101', role: 'primary_sponsor' },
      { legislatorExternalId: '202', role: 'sponsor' },
      { legislatorExternalId: 'manual:zohran-mamdani', role: 'actor' },
    ])
  })
})
