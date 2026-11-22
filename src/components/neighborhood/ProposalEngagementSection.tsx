'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Minus, Bell, Users, MessageSquare } from 'lucide-react'
import { setProposalStance, followProposal, unfollowProposal, type ProposalStance } from '@/app/actions/proposal-engagement'

type Stats = {
  support_count: number
  oppose_count: number
  neutral_count: number
  watching_count: number
  comment_count: number
  bookmark_count: number
}

const OPINION_STANCES = [
  {
    value: 'support' as ProposalStance,
    label: 'Support',
    icon: <ThumbsUp size={14} />,
    tallyIcon: <ThumbsUp size={18} />,
    activeClasses: 'bg-emerald-50 border-emerald-300 text-emerald-700',
    tallyColor: 'text-emerald-600',
    tallyBg: 'bg-emerald-50',
    tallyBorder: 'border-emerald-200',
    countKey: 'support_count' as keyof Stats,
    tooltip: 'I support this proposal',
  },
  {
    value: 'oppose' as ProposalStance,
    label: 'Oppose',
    icon: <ThumbsDown size={14} />,
    tallyIcon: <ThumbsDown size={18} />,
    activeClasses: 'bg-red-50 border-red-300 text-red-700',
    tallyColor: 'text-red-600',
    tallyBg: 'bg-red-50',
    tallyBorder: 'border-red-200',
    countKey: 'oppose_count' as keyof Stats,
    tooltip: 'I oppose this proposal',
  },
  {
    value: 'neutral' as ProposalStance,
    label: 'Neutral',
    icon: <Minus size={14} />,
    tallyIcon: <Minus size={18} />,
    activeClasses: 'bg-amber-50 border-amber-300 text-amber-700',
    tallyColor: 'text-amber-600',
    tallyBg: 'bg-amber-50',
    tallyBorder: 'border-amber-200',
    countKey: 'neutral_count' as keyof Stats,
    tooltip: "I've reviewed this and have no strong opinion",
  },
]

const INACTIVE = 'border-nyc-border text-nyc-muted hover:border-nyc-border-light hover:text-nyc-blue hover:bg-nyc-card-hover'
const DISABLED = 'border-nyc-border/40 text-nyc-muted/30 cursor-not-allowed'

function applyStanceChange(stats: Stats, prev: ProposalStance | null, next: ProposalStance | null): Stats {
  const updated = { ...stats }
  const key = (s: ProposalStance): keyof Stats =>
    s === 'support' ? 'support_count'
    : s === 'oppose' ? 'oppose_count'
    : 'neutral_count'

  if (prev) updated[key(prev)] = Math.max(0, updated[key(prev)] as number - 1)
  if (next) updated[key(next)] = (updated[key(next)] as number) + 1
  return updated
}

export default function ProposalEngagementSection({
  proposalId,
  initialStats,
  initialUserStance,
  initialWatching,
  isLoggedIn,
}: {
  proposalId: string
  initialStats: Stats
  initialUserStance: ProposalStance | null
  initialWatching: boolean
  isLoggedIn: boolean
}) {
  const [stats, setStats] = useState<Stats>(initialStats)
  const [currentStance, setCurrentStance] = useState<ProposalStance | null>(initialUserStance)
  const [isFollowing, setIsFollowing] = useState(initialWatching)
  const [pending, setPending] = useState(false)
  const [followPending, setFollowPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStance(stance: ProposalStance) {
    if (!isLoggedIn || pending) return
    setError(null)

    const prev = currentStance
    const next = prev === stance ? null : stance
    const prevStats = stats

    setCurrentStance(next)
    setStats(applyStanceChange(stats, prev, next))

    setPending(true)
    const result = await setProposalStance(proposalId, next)
    setPending(false)

    if (result.error) {
      setCurrentStance(prev)
      setStats(prevStats)
      setError(result.error)
    }
  }

  async function handleFollow() {
    if (!isLoggedIn || followPending) return
    setError(null)

    const prev = isFollowing
    const prevStats = stats
    setIsFollowing(!prev)
    setStats((s) => ({
      ...s,
      watching_count: prev ? Math.max(0, s.watching_count - 1) : s.watching_count + 1,
    }))

    setFollowPending(true)
    const result = prev
      ? await unfollowProposal(proposalId)
      : await followProposal(proposalId)
    setFollowPending(false)

    if (result.error) {
      setIsFollowing(prev)
      setStats(prevStats)
      setError(result.error)
    }
  }

  const total = stats.support_count + stats.oppose_count + stats.neutral_count

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs text-nyc-muted">Your stance</p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Your stance">
          {OPINION_STANCES.map((s) => {
            const isActive = currentStance === s.value
            return (
              <button
                key={s.value}
                onClick={() => handleStance(s.value)}
                disabled={!isLoggedIn || pending}
                title={isLoggedIn ? s.tooltip : 'Sign in to take a stance'}
                aria-pressed={isActive}
                className={[
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
                  !isLoggedIn || pending ? DISABLED : isActive ? s.activeClasses : INACTIVE,
                ].join(' ')}
              >
                {s.icon}
                <span>{s.label}</span>
                <span className="tabular-nums opacity-80">
                  {(stats[s.countKey] as number).toLocaleString()}
                </span>
              </button>
            )
          })}

          <span className="mx-1 h-4 w-px bg-nyc-border" />

          <button
            onClick={handleFollow}
            disabled={!isLoggedIn || followPending}
            title={isLoggedIn ? (isFollowing ? 'Unfollow this proposal' : 'Follow for updates') : 'Sign in to follow'}
            aria-pressed={isFollowing}
            className={[
              'group flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
              !isLoggedIn || followPending
                ? DISABLED
                : isFollowing
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : INACTIVE,
            ].join(' ')}
          >
            <Bell size={14} />
            {isFollowing ? (
              <>
                <span className="group-hover:hidden">Following</span>
                <span className="hidden group-hover:inline">Unfollow</span>
              </>
            ) : (
              <span>Follow</span>
            )}
            <span className="tabular-nums opacity-80">
              {stats.watching_count.toLocaleString()}
            </span>
          </button>

          {!isLoggedIn && (
            <span className="ml-1 text-xs text-nyc-muted/60">Sign in to engage</span>
          )}
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-500">Failed to save: {error}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {OPINION_STANCES.map((s) => (
          <div
            key={s.value}
            className={`rounded border p-3 ${s.tallyBg} ${s.tallyBorder}`}
          >
            <div className={`mb-1 ${s.tallyColor}`}>{s.tallyIcon}</div>
            <p className={`text-xl font-bold tabular-nums ${s.tallyColor}`}>
              {(stats[s.countKey] as number).toLocaleString()}
            </p>
            <p className="text-xs text-nyc-muted">{s.label}</p>
          </div>
        ))}
        <div className="rounded border border-blue-200 bg-blue-50 p-3">
          <div className="mb-1 text-blue-600"><Users size={18} /></div>
          <p className="text-xl font-bold tabular-nums text-blue-600">
            {stats.watching_count.toLocaleString()}
          </p>
          <p className="text-xs text-nyc-muted">Following</p>
        </div>
      </div>

      {total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-nyc-muted">
            <span>{Math.round((stats.support_count / total) * 100)}% support</span>
            <span>{total.toLocaleString()} stances</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-nyc-border">
            <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${(stats.support_count / total) * 100}%` }} />
            <div className="bg-amber-500 transition-all duration-300" style={{ width: `${(stats.neutral_count / total) * 100}%` }} />
            <div className="bg-red-500 transition-all duration-300" style={{ width: `${(stats.oppose_count / total) * 100}%` }} />
          </div>
          <div className="mt-1 flex gap-4 text-xs text-nyc-muted/70">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Support</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Neutral</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Oppose</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 border-t border-nyc-border pt-4 text-sm text-nyc-muted">
        <span className="flex items-center gap-1.5">
          <MessageSquare size={14} />
          {stats.comment_count.toLocaleString()} comments
        </span>
      </div>
    </div>
  )
}
