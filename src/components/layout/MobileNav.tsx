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

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function close() { setOpen(false) }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm sm:hidden"
          onClick={close}
        />
      )}

      <div
        className={[
          'fixed inset-y-0 left-0 z-[70] w-72 bg-nyc-card border-r border-nyc-border flex flex-col transition-transform duration-300 ease-in-out sm:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-nyc-border px-4 py-4">
          <Link
            href="/"
            onClick={close}
            className="flex items-center gap-2"
          >
            <Scale size={18} className="text-nyc-orange" />
            <span className="text-sm font-black uppercase tracking-widest text-nyc-blue">NYC Tracker</span>
          </Link>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-nyc-muted hover:bg-nyc-blue hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <p className="px-2 pb-1 text-xs font-black uppercase tracking-widest text-nyc-orange">
            Browse
          </p>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className="block rounded-lg px-3 py-2.5 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
            >
              {link.label}
            </Link>
          ))}

          {isLoggedIn && (
            <>
              <div className="pt-3">
                <p className="px-2 pb-1 text-xs font-black uppercase tracking-widest text-nyc-orange">
                  My Account
                </p>
              </div>
              {username && (
                <Link
                  href={`/users/${username}`}
                  onClick={close}
                  className="block rounded-lg px-3 py-2.5 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
                >
                  Profile
                </Link>
              )}
              {AUTH_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className="block rounded-lg px-3 py-2.5 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        {!isLoggedIn && (
          <div className="border-t border-nyc-border px-4 py-4">
            <Link
              href="/login"
              onClick={close}
              className="block w-full rounded-lg bg-nyc-orange px-4 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-nyc-orange-hover"
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
