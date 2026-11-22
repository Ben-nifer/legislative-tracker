import type { SupabaseClient } from '@supabase/supabase-js'

// Auto-generated usernames at first sign-in (onboarding-build-planv1.1.md §4.3, B9).
// Same rules as the profile editor: 3–30 chars of a–z, 0–9 and underscore.

const BASE_MAX = 20
const FALLBACK_BASE = 'user'

// "José García" → "josegarcia"; "jane.doe+news@x.com" → "janedoe"
export function usernameBase(fullName: string | null | undefined, email: string | null | undefined): string {
  const source = fullName?.trim() || email?.split('@')[0]?.split('+')[0] || ''
  const base = source
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, BASE_MAX)
  return base.length >= 3 ? base : FALLBACK_BASE
}

// The base itself, else the base plus the lowest free number from 2 up
export function pickUsername(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export function displayNameFor(fullName: string | null | undefined, email: string | null | undefined): string {
  return (fullName?.trim() || email?.split('@')[0] || 'New member').slice(0, 50)
}

interface NewUser {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}

// Creates the user_profiles row. A concurrent sign-up can take the same name
// between the read and the insert, so a unique violation retries with a random suffix.
export async function createProfileWithGeneratedUsername(supabase: SupabaseClient, user: NewUser): Promise<string> {
  const meta = user.user_metadata ?? {}
  const fullName = (meta.full_name ?? meta.name) as string | undefined
  const base = usernameBase(fullName, user.email)

  const { data: existing, error: readError } = await supabase
    .from('user_profiles')
    .select('username')
    .like('username', `${base}%`)
  if (readError) throw new Error(`username lookup failed: ${readError.message}`)

  let username = pickUsername(base, new Set((existing ?? []).map((r) => r.username as string)))
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from('user_profiles').insert({
      id: user.id,
      username,
      display_name: displayNameFor(fullName, user.email),
    })
    if (!error) return username
    if (error.code !== '23505') throw new Error(`profile insert failed: ${error.message}`)
    if (error.message.includes('user_profiles_pkey')) return username // created by a parallel callback
    username = `${base}${Math.floor(1000 + Math.random() * 9000)}`
  }
  throw new Error('could not find a free username')
}
