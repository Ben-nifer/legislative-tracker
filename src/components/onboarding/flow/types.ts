import type { Coverage } from '@/lib/onboarding/data/coverage'
import type { TopicChip } from '@/lib/onboarding/data/topics'
import type { RepresentativeCard } from '@/lib/onboarding/data/representatives'
import type { Selections } from '@/lib/onboarding/data/selections'

// What the /welcome server page hands the client flow
export interface FlowData {
  initial: Selections
  signedIn: boolean
  coverage: Coverage
  chips: TopicChip[]
  reps: RepresentativeCard[]
  // Display names for IDs already in `initial`
  placeNames: Record<string, string> // NTA code → name
  politicians: Record<string, PoliticianInfo> // legislator ID → card info
  topicNames: Record<string, string> // topic ID → name (followed topics outside the chips)
  steps: { politicians: boolean; interests: boolean } // kill switches (build plan §3.2)
}

export interface PoliticianInfo {
  id: string
  name: string
  office: string // "Council Member · District 39"
  party: string | null
  photoUrl: string | null
  reason?: string | null
}

export type Selection = Selections
