import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { createProfileWithGeneratedUsername } from '@/lib/onboarding/username'
import { GUEST_CONTEXT_COOKIE, parseGuestContext } from '@/lib/onboarding/guest'
import {
  PENDING_ACTION_COOKIE,
  SESSION_ID_COOKIE,
  parsePendingAction,
  readSessionId,
  safeRedirectPath,
} from '@/lib/onboarding/session'
import {
  carryOverGuestContext,
  completePendingAction,
  linkGuestSession,
  recordServerEvent,
} from '@/lib/onboarding/carry-over'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeRedirectPath(searchParams.get('next'))

  if (!code) return NextResponse.redirect(`${origin}/login?error=auth_failed`)

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return NextResponse.redirect(`${origin}/login?error=auth_failed`)

  const user = data.user
  const service = createServiceClient()

  // First sign-in: create the profile with a generated username (B9); no username step
  const { data: profile } = await service.from('user_profiles').select('id').eq('id', user.id).maybeSingle()
  const isNew = !profile
  if (isNew) {
    try {
      await createProfileWithGeneratedUsername(service, user)
    } catch (err) {
      console.error('Profile creation failed:', err instanceof Error ? err.message : err)
      return NextResponse.redirect(`${origin}/login?error=profile_failed`)
    }
  }

  // Carry the guest session into the account (build plan §4.3). Each step is
  // best-effort: a failure is logged and never blocks the sign-in.
  const cookieStore = await cookies()
  const guestContext = parseGuestContext(cookieStore.get(GUEST_CONTEXT_COOKIE)?.value)
  const pending = parsePendingAction(cookieStore.get(PENDING_ACTION_COOKIE)?.value)
  const sessionId = readSessionId(cookieStore.get(SESSION_ID_COOKIE)?.value)
  const method = user.app_metadata?.provider === 'google' ? 'google' : user.app_metadata?.provider === 'email' ? 'email' : null

  const steps: [string, () => Promise<void>][] = [
    ['guest context', async () => { if (guestContext) await carryOverGuestContext(service, user.id, guestContext) }],
    ['pending action', async () => { if (pending) await completePendingAction(service, user.id, pending) }],
    ['session link', async () => { if (sessionId) await linkGuestSession(service, user.id, sessionId) }],
    ['auth_success', async () => {
      if (sessionId && method) {
        await recordServerEvent(service, sessionId, user.id, { name: 'auth_success', props: { method, new_account: isNew } })
      }
    }],
  ]
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (err) {
      console.error(`Sign-in carry-over (${label}) failed:`, err instanceof Error ? err.message : err)
    }
  }

  // New accounts accept the terms first, as they did on the way to the old
  // username step; then back to where the user was.
  const termsAccepted = cookieStore.get('terms_accepted')?.value === '1'
  const destination = isNew && !termsAccepted ? `/terms/accept?next=${encodeURIComponent(next)}` : next

  const response = NextResponse.redirect(`${origin}${destination}`)
  response.cookies.delete(GUEST_CONTEXT_COOKIE)
  response.cookies.delete(PENDING_ACTION_COOKIE)
  return response
}
