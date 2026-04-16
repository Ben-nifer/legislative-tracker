import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import UserMenu from './UserMenu'
import NotificationBell from '@/components/notifications/NotificationBell'
import MobileNav from './MobileNav'
import { Scale } from 'lucide-react'

const PUBLIC_NAV_LINKS = [
  { href: '/legislation', label: 'Legislation' },
  { href: '/council-members', label: 'Council Members' },
]

const AUTH_NAV_LINKS = [
  { href: '/following', label: 'Following' },
]

export default async function Header() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile: { display_name: string; username: string; avatar_url: string | null } | null = null
  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('display_name, username, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
    profile = data
  }

  const navLinks = user ? [...PUBLIC_NAV_LINKS, ...AUTH_NAV_LINKS] : PUBLIC_NAV_LINKS

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* Mobile nav drawer (button visible on mobile only) */}
        <MobileNav isLoggedIn={!!user} username={profile?.username ?? null} />

        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-white shrink-0"
        >
          <Scale size={18} className="text-indigo-400" />
          <span className="hidden sm:inline">NYC Legislative Tracker</span>
          <span className="sm:hidden">NYC Tracker</span>
        </Link>

        {/* Nav — desktop only */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          {user && profile ? (
            <>
              <NotificationBell />
              <UserMenu
                displayName={profile.display_name}
                username={profile.username}
                avatarUrl={profile.avatar_url ?? null}
              />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
