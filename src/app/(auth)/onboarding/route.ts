import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { createProfileWithGeneratedUsername } from '@/lib/onboarding/username'
import { safeRedirectPath } from '@/lib/onboarding/session'

// The username step is retired (onboarding-build-planv1.1.md B9): profiles are
// created with a generated username at sign-in. This route only repairs a
// signed-in account that has no profile yet (created before the change), then
// moves on.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const destination = safeRedirectPath(searchParams.get('next'))

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const service = createServiceClient()
    const { data: profile } = await service.from('user_profiles').select('id').eq('id', user.id).maybeSingle()
    if (!profile) {
      try {
        await createProfileWithGeneratedUsername(service, user)
      } catch (err) {
        console.error('Profile creation failed:', err instanceof Error ? err.message : err)
        return NextResponse.redirect(`${origin}/`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${destination}`)
}
