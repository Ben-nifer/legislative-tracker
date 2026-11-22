import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { flags } from '@/lib/flags'
import {
  ONBOARDING_SEEN_COOKIE,
  SESSION_ID_COOKIE,
  newSessionId,
  readSessionId,
} from '@/lib/onboarding/session'

// Routes that require authentication
const protectedRoutes = ['/bookmarks', '/following', '/profile', '/settings']

// Crawlers and link previews keep seeing the public home page (build plan §3.1)
const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|whatsapp|lighthouse|google-inspectiontool/i

// Session cookies: no expiry, so they go when the browser closes (B8)
const SESSION_COOKIE = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const response = route(request, supabaseResponse, !!user)

  // Every browser session gets an ID for analytics_events / feed_impressions
  if (!readSessionId(request.cookies.get(SESSION_ID_COOKIE)?.value)) {
    response.cookies.set(SESSION_ID_COOKIE, newSessionId(), SESSION_COOKIE)
  }
  return response
}

function route(request: NextRequest, supabaseResponse: NextResponse, signedIn: boolean): NextResponse {
  const { pathname } = request.nextUrl

  if (flags.newOnboarding) {
    const seenWelcome = request.cookies.has(ONBOARDING_SEEN_COOKIE)

    // New signed-out visitors start at onboarding S0 (B8)
    if (pathname === '/' && !signedIn && !seenWelcome && !BOT_UA.test(request.headers.get('user-agent') ?? '')) {
      return NextResponse.redirect(new URL('/welcome', request.url))
    }
    if (pathname.startsWith('/welcome') && !seenWelcome) {
      supabaseResponse.cookies.set(ONBOARDING_SEEN_COOKIE, '1', SESSION_COOKIE)
    }
  }

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  )

  if (isProtected && !signedIn) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect logged-in users away from login page
  if (pathname === '/login' && signedIn) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Require terms acceptance for logged-in users on protected routes
  if (isProtected && signedIn && pathname !== '/terms/accept') {
    const termsAccepted = request.cookies.get('terms_accepted')?.value === '1'
    if (!termsAccepted) {
      const acceptUrl = request.nextUrl.clone()
      acceptUrl.pathname = '/terms/accept'
      acceptUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(acceptUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
