'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { User, LogOut, ChevronDown, ExternalLink, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function UserMenu({
  displayName,
  username,
}: {
  displayName: string
  username: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-700"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/30 text-xs font-semibold text-indigo-300">
          {initials}
        </span>
        <span className="hidden sm:inline">{displayName}</span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-slate-700 bg-slate-800 py-1 shadow-xl">
          <p className="px-3 py-2 text-xs text-slate-500">@{username}</p>
          <div className="my-1 border-t border-slate-700" />
          <Link
            href={`/users/${username}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <ExternalLink size={14} /> Public Profile
          </Link>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <User size={14} /> Edit Profile
          </Link>
          <Link
            href="/following"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <Users size={14} /> Following
          </Link>
          <Link
            href="/followers"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <Users size={14} /> Followers
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
