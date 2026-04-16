'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Menu, X, Scale } from 'lucide-react'

const NAV_LINKS = [
  { href: '/legislation', label: 'Legislation' },
  { href: '/council-members', label: 'Council Members' },
  { href: '/trending', label: 'Trending' },
]

const AUTH_LINKS = [
  { href: '/following', label: 'Following' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/settings', label: 'Settings' },
]

export default function MobileNav({
  isLoggedIn,
  username,
}: {
  isLoggedIn: boolean
  username: string | null
}) {
  const [open, setOpen] = useState(false)

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function close() { setOpen(false) }

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={close}
        />
      )}

      {/* Drawer */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-300 ease-in-out sm:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <Link
            href="/"
            onClick={close}
            className="flex items-center gap-2 text-sm font-semibold text-white"
          >
            <Scale size={18} className="text-indigo-400" />
            NYC Legislative Tracker
          </Link>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-600">
            Browse
          </p>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className="block rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {link.label}
            </Link>
          ))}

          {isLoggedIn && (
            <>
              <div className="pt-3">
                <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                  My Account
                </p>
              </div>
              {username && (
                <Link
                  href={`/users/${username}`}
                  onClick={close}
                  className="block rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  Profile
                </Link>
              )}
              {AUTH_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className="block rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Bottom: sign-in if logged out */}
        {!isLoggedIn && (
          <div className="border-t border-slate-800 px-4 py-4">
            <Link
              href="/login"
              onClick={close}
              className="block w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-indigo-400"
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
