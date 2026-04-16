'use client'

import { useState, useTransition } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { followLegislation, unfollowLegislation } from '@/app/actions/social'
import Link from 'next/link'

export default function WatchButton({
  legislationId,
  initialFollowing,
  isLoggedIn,
}: {
  legislationId: string
  initialFollowing: boolean
  isLoggedIn: boolean
}) {
  const [following, setFollowing] = useState(initialFollowing)
  const [isPending, startTransition] = useTransition()

  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
      >
        <Bell size={14} />
        Follow
      </Link>
    )
  }

  function toggle() {
    const wasFollowing = following
    setFollowing(!wasFollowing)
    startTransition(async () => {
      const result = wasFollowing
        ? await unfollowLegislation(legislationId)
        : await followLegislation(legislationId)
      if (result.error) setFollowing(wasFollowing)
    })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
        following
          ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300'
          : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600 hover:text-slate-100',
        isPending ? 'opacity-50 cursor-wait' : '',
      ].join(' ')}
    >
      {following ? <BellOff size={14} /> : <Bell size={14} />}
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
