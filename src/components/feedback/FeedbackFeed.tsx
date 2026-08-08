'use client'

import { useState, useMemo } from 'react'
import { Flame, Clock, MessageSquarePlus } from 'lucide-react'
import FeedbackCard from './FeedbackCard'
import type { FeedbackPost } from './types'

type Sort = 'liked' | 'newest'

export default function FeedbackFeed({
  posts,
  currentUserId,
}: {
  posts: FeedbackPost[]
  currentUserId: string | null
}) {
  const [sort, setSort] = useState<Sort>('liked')

  const sorted = useMemo(() => {
    if (sort === 'liked') {
      return [...posts].sort(
        (a, b) =>
          b.likeCount - a.likeCount ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }
    return [...posts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [posts, sort])

  return (
    <div>
      {/* Sort controls */}
      <div className="mb-5 flex items-center gap-2">
        <SortButton
          active={sort === 'liked'}
          onClick={() => setSort('liked')}
          icon={<Flame size={13} />}
          label="Most Liked"
        />
        <SortButton
          active={sort === 'newest'}
          onClick={() => setSort('newest')}
          icon={<Clock size={13} />}
          label="Newest"
        />
        {posts.length > 0 && (
          <span className="ml-auto text-xs text-nyc-muted-light">
            {posts.length} {posts.length === 1 ? 'submission' : 'submissions'}
          </span>
        )}
      </div>

      {/* Posts */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-nyc-border/30 py-20 text-center">
          <MessageSquarePlus className="mb-3 text-nyc-muted-light/30" size={40} />
          <p className="text-sm font-medium text-nyc-muted-light">No feedback yet</p>
          <p className="mt-1 text-xs text-nyc-muted-light/60">Be the first to share a feature request or bug report.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((post) => (
            <FeedbackCard key={post.id} post={post} currentUserId={currentUserId} />
          ))}
        </div>
      )}
    </div>
  )
}

function SortButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors',
        active
          ? 'border-nyc-orange bg-nyc-orange/10 text-nyc-orange'
          : 'border-nyc-border/40 text-nyc-muted-light hover:border-nyc-border hover:text-white',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
