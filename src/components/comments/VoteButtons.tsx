'use client'

import { useState } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { voteComment } from '@/app/actions/comments'

export default function VoteButtons({
  commentId,
  initialScore,
  initialUserVote,
  isLoggedIn,
}: {
  commentId: string
  initialScore: number
  initialUserVote: 1 | -1 | null
  isLoggedIn: boolean
}) {
  const [score, setScore] = useState(initialScore)
  const [userVote, setUserVote] = useState<1 | -1 | null>(initialUserVote)
  const [pending, setPending] = useState(false)

  async function handleVote(v: 1 | -1) {
    if (!isLoggedIn || pending) return
    const prev = userVote
    const prevScore = score
    const next: 1 | -1 | 0 = prev === v ? 0 : v
    setUserVote(next === 0 ? null : next)
    setScore(prevScore + (next === 0 ? -prev! : next - (prev ?? 0)))
    setPending(true)
    const result = await voteComment(commentId, next)
    setPending(false)
    if (result.error) {
      setUserVote(prev)
      setScore(prevScore)
    }
  }

  const scoreColor =
    score > 0 ? 'text-nyc-orange' : score < 0 ? 'text-red-500' : 'text-nyc-muted'

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleVote(1)}
        disabled={!isLoggedIn || pending}
        title={isLoggedIn ? 'Upvote' : 'Sign in to vote'}
        className={[
          'rounded p-0.5 transition-colors',
          !isLoggedIn || pending
            ? 'cursor-not-allowed text-nyc-muted/30'
            : userVote === 1
            ? 'text-nyc-orange'
            : 'text-nyc-muted hover:text-nyc-orange',
        ].join(' ')}
      >
        <ArrowUp size={15} />
      </button>

      <span className={`min-w-[1.5rem] text-center text-xs font-semibold tabular-nums ${scoreColor}`}>
        {score}
      </span>

      <button
        onClick={() => handleVote(-1)}
        disabled={!isLoggedIn || pending}
        title={isLoggedIn ? 'Downvote' : 'Sign in to vote'}
        className={[
          'rounded p-0.5 transition-colors',
          !isLoggedIn || pending
            ? 'cursor-not-allowed text-nyc-muted/30'
            : userVote === -1
            ? 'text-red-500'
            : 'text-nyc-muted hover:text-red-500',
        ].join(' ')}
      >
        <ArrowDown size={15} />
      </button>
    </div>
  )
}
