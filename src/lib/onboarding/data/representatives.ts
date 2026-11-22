import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuestPlace } from '../guest'

// getRepresentatives (onboarding-build-planv1.1.md §4.4, B10): S3 "Your
// representatives". Council Member + Mayor have records; state and federal
// offices show as "Coming soon" until those bodies are ingested (B3).
// Ordered by level, federal → local (spec §S3), never by party.

export interface RepLegislator {
  id: string
  fullName: string
  slug: string
  title: string | null
  district: string | null
  photoUrl: string | null
  party: string | null // shown as a text label only
}

export interface RepresentativeCard {
  office: string // "U.S. Senators", "Council Member", …
  level: 'federal' | 'state' | 'city'
  districtLabel: string | null // "NY-10", "District 39"
  legislator: RepLegislator | null
  comingSoon: boolean
}

const SELECT = 'id, full_name, slug, title, district, photo_url, party'

function toRep(r: Record<string, unknown>): RepLegislator {
  return {
    id: r.id as string,
    fullName: r.full_name as string,
    slug: r.slug as string,
    title: (r.title as string | null) ?? null,
    district: (r.district as string | null) ?? null,
    photoUrl: (r.photo_url as string | null) ?? null,
    party: (r.party as string | null) ?? null,
  }
}

export function buildRepresentatives(
  places: GuestPlace[],
  found: { councilMember: RepLegislator | null; mayor: RepLegislator | null }
): RepresentativeCard[] {
  const id = (type: GuestPlace['type']) => places.find((p) => p.type === type)?.id ?? null
  const council = id('council_district')
  if (!council) return [] // no NYC address resolved: S3 shows only "Active in…"

  const congressional = id('congressional')
  const senate = id('state_senate')
  const assembly = id('assembly')
  const soon = (office: string, level: RepresentativeCard['level'], districtLabel: string | null): RepresentativeCard => ({
    office,
    level,
    districtLabel,
    legislator: null,
    comingSoon: true,
  })

  return [
    soon('U.S. Senators', 'federal', 'New York'),
    soon('U.S. Representative', 'federal', congressional ? `NY-${congressional}` : null),
    soon('State Senator', 'state', senate ? `District ${senate}` : null),
    soon('Assembly Member', 'state', assembly ? `District ${assembly}` : null),
    {
      office: 'Council Member',
      level: 'city',
      districtLabel: `District ${council}`,
      legislator: found.councilMember,
      comingSoon: false,
    },
    { office: 'Mayor', level: 'city', districtLabel: 'New York City', legislator: found.mayor, comingSoon: false },
  ]
}

export async function getRepresentatives(supabase: SupabaseClient, places: GuestPlace[]): Promise<RepresentativeCard[]> {
  const council = places.find((p) => p.type === 'council_district')?.id
  if (!council) return []

  const [councilRes, mayorRes] = await Promise.all([
    supabase
      .from('legislators')
      .select(SELECT)
      .eq('district', council)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('legislators')
      .select(SELECT)
      .eq('is_manual', true)
      .eq('title', 'Mayor')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])
  if (councilRes.error) throw new Error(`council member read failed: ${councilRes.error.message}`)
  if (mayorRes.error) throw new Error(`mayor read failed: ${mayorRes.error.message}`)

  return buildRepresentatives(places, {
    councilMember: councilRes.data ? toRep(councilRes.data) : null,
    mayor: mayorRes.data ? toRep(mayorRes.data) : null,
  })
}
