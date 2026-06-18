'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut, ChevronDown, ExternalLink, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Avatar from '@/components/profile/Avatar'

export default function UserMenu({
  displayName,
  username,
  avatarUrl,
}: {
  displayName: string
  username: string
  avatarUrl: string | null
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-nyc-border bg-nyc-card px-3 py-1.5 text-sm text-nyc-blue transition-colors hover:border-nyc-blue hover:bg-nyc-blue hover:text-white"
      >
        <Avatar src={avatarUrl} name={displayName} size="sm" />
        <span className="hidden sm:inline">{displayName}</span>
        <ChevronDown size={14} className="text-nyc-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-nyc-border bg-nyc-card py-1 shadow-xl">
          <p className="px-3 py-2 text-xs text-nyc-muted">@{username}</p>
          <div className="my-1 border-t border-nyc-border" />
          <Link
            href={`/users/${username}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
          >
            <ExternalLink size={14} /> Profile
          </Link>
          <Link
            href="/following"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
          >
            <Users size={14} /> Following
          </Link>
          <Link
            href="/followers"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
          >
            <Users size={14} /> Followers
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-nyc-muted transition-colors hover:bg-nyc-blue hover:text-white"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
