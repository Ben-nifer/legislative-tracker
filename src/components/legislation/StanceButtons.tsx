'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Minus } from 'lucide-react'
import { setStance, type Stance } from '@/app/actions/engagement'

type Stats = {
  support_count: number
  oppose_count: number
  neutral_count: number
  watching_count: number
}

type StanceConfig = {
  value: Stance
  label: string
  shortLabel: string
  icon: React.ReactNode
  activeClasses: string
  countKey: keyof Pick<Stats, 'support_count' | 'oppose_count' | 'neutral_count'>
  showCount: boolean
  tooltip: string
}

const STANCES: StanceConfig[] = [
  {
    value: 'support',
    label: 'Support',
    shortLabel: 'Support',
    icon: <ThumbsUp size={14} />,
    activeClasses: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300',
    countKey: 'support_count',
    showCount: true,
    tooltip: 'I support this legislation',
  },
  {
    value: 'oppose',
    label: 'Oppose',
    shortLabel: 'Oppose',
    icon: <ThumbsDown size={14} />,
    activeClasses: 'bg-red-500/20 border-red-500/60 text-red-300',
    countKey: 'oppose_count',
    showCount: true,
    tooltip: 'I oppose this legislation',
  },
  {
    value: 'neutral',
    label: 'Neutral',
    shortLabel: 'Neutral',
    icon: <Minus size={14} />,
    activeClasses: 'bg-amber-500/20 border-amber-500/60 text-amber-300',
    countKey: 'neutral_count',
    showCount: true,
    tooltip: "I've reviewed this and have no strong opinion",
  },
]

const INACTIVE_CLASSES =
  'border-slate-600/60 text-slate-400 hover:border-slate-500 hover:text-slate-300 hover:bg-slate-700/40'

const DISABLED_CLASSES =
  'border-slate-700/40 text-slate-600 cursor-not-allowed'

export default function StanceButtons({
  legislationId,
  initialStats,
  initialUserStance = null,
  isLoggedIn = false,
}: {
  legislationId: string
  initialStats: Stats
  initialUserStance?: Stance | null
  isLoggedIn?: boolean
}) {
  const [currentStance, setCurrentStance] = useState<Stance | null>(
    initialUserStance
  )
  const [stats, setStats] = useState<Stats>(initialStats)
  const [pending, setPending] = useState(false)

  async function handleClick(stance: Stance) {
    if (!isLoggedIn || pending) return

    const prevStance = currentStance
    const prevStats = stats

    // Clicking the active stance toggles it off
    const nextStance = prevStance === stance ? null : stance

    // Optimistic update
    setCurrentStance(nextStance)
    setStats(applyStanceChange(stats, prevStance, nextStance))

    setPending(true)
    const result = await setStance(legislationId, nextStance)
    setPending(false)

    if (result.error) {
      // Revert on error
      setCurrentStance(prevStance)
      setStats(prevStats)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Your stance">
      {STANCES.map((s) => {
        const isActive = currentStance === s.value
        const count = s.showCount ? stats[s.countKey] : null

        return (
          <button
            key={s.value}
            onClick={() => handleClick(s.value)}
            disabled={!isLoggedIn || pending}
            title={isLoggedIn ? s.tooltip : 'Sign in to take a stance'}
            aria-pressed={isActive}
            className={[
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
              !isLoggedIn || pending
                ? DISABLED_CLASSES
                : isActive
                  ? s.activeClasses
                  : INACTIVE_CLASSES,
            ].join(' ')}
          >
            {s.icon}
            <span>{s.shortLabel}</span>
            {count !== null && (
              <span className="tabular-nums opacity-80">
                {count.toLocaleString()}
              </span>
            )}
          </button>
        )
      })}

      {!isLoggedIn && (
        <span className="ml-1 text-xs text-slate-600">Sign in to engage</span>
      )}
    </div>
  )
}

/**
 * Pure helper — adjusts counts when stance changes, without hitting the DB.
 * The `legislation_stats` view will be authoritative on next revalidation.
 */
function applyStanceChange(
  stats: Stats,
  prev: Stance | null,
  next: Stance | null
): Stats {
  const delta: Partial<Stats> = {}

  const countKey: Record<'support' | 'oppose' | 'neutral', keyof Stats> = {
    support: 'support_count',
    oppose: 'oppose_count',
    neutral: 'neutral_count',
  }

  // Decrement old stance count
  if (prev) {
    const key = countKey[prev]
    delta[key] = Math.max(0, stats[key] - 1)
  }

  // Increment new stance count
  if (next) {
    const key = countKey[next]
    delta[key] = (delta[key] ?? stats[key]) + 1
  }

  return { ...stats, ...delta }
}
