'use client'

import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { followLegislation, unfollowLegislation } from '@/app/actions/social'

export default function BookmarkButton({
  legislationId,
  initialBookmarked = false,
  isLoggedIn = false,
}: {
  legislationId: string
  initialBookmarked?: boolean
  isLoggedIn?: boolean
}) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked)
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (!isLoggedIn || pending) return

    const prev = bookmarked
    setBookmarked(!prev) // optimistic

    setPending(true)
    const result = prev
      ? await unfollowLegislation(legislationId)
      : await followLegislation(legislationId)
    setPending(false)

    if (result.error) {
      setBookmarked(prev) // revert on error
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={!isLoggedIn || pending}
      title={
        !isLoggedIn
          ? 'Sign in to bookmark'
          : bookmarked
            ? 'Remove bookmark'
            : 'Bookmark this legislation'
      }
      aria-pressed={bookmarked}
      className={[
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
        !isLoggedIn || pending
          ? 'border-slate-700/40 text-slate-600 cursor-not-allowed'
          : bookmarked
            ? 'bg-indigo-500/20 border-indigo-500/60 text-indigo-300'
            : 'border-slate-600/60 text-slate-400 hover:border-slate-500 hover:text-slate-300 hover:bg-slate-700/40',
      ].join(' ')}
    >
      <Bookmark size={14} className={bookmarked ? 'fill-current' : ''} />
      <span>{bookmarked ? 'Saved' : 'Save'}</span>
    </button>
  )
}
