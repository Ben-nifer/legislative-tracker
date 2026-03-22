'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Minus, Eye, MessageSquare, Bookmark } from 'lucide-react'
import { setStance, type Stance } from '@/app/actions/engagement'

type Stats = {
  support_count: number
  oppose_count: number
  neutral_count: number
  watching_count: number
  comment_count: number
  bookmark_count: number
}

const STANCES = [
  {
    value: 'support' as Stance,
    label: 'Support',
    icon: <ThumbsUp size={14} />,
    tallyIcon: <ThumbsUp size={18} />,
    activeClasses: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300',
    tallyColor: 'text-emerald-400',
    tallyBg: 'bg-emerald-500/10',
    tallyBorder: 'border-emerald-500/20',
    countKey: 'support_count' as keyof Stats,
    tooltip: 'I support this legislation',
  },
  {
    value: 'oppose' as Stance,
    label: 'Oppose',
    icon: <ThumbsDown size={14} />,
    tallyIcon: <ThumbsDown size={18} />,
    activeClasses: 'bg-red-500/20 border-red-500/60 text-red-300',
    tallyColor: 'text-red-400',
    tallyBg: 'bg-red-500/10',
    tallyBorder: 'border-red-500/20',
    countKey: 'oppose_count' as keyof Stats,
    tooltip: 'I oppose this legislation',
  },
  {
    value: 'neutral' as Stance,
    label: 'Neutral',
    icon: <Minus size={14} />,
    tallyIcon: <Minus size={18} />,
    activeClasses: 'bg-amber-500/20 border-amber-500/60 text-amber-300',
    tallyColor: 'text-amber-400',
    tallyBg: 'bg-amber-500/10',
    tallyBorder: 'border-amber-500/20',
    countKey: 'neutral_count' as keyof Stats,
    tooltip: "I've reviewed this and have no strong opinion",
  },
  {
    value: 'watching' as Stance,
    label: 'Watching',
    icon: <Eye size={14} />,
    tallyIcon: <Eye size={18} />,
    activeClasses: 'bg-blue-500/20 border-blue-500/60 text-blue-300',
    tallyColor: 'text-blue-400',
    tallyBg: 'bg-blue-500/10',
    tallyBorder: 'border-blue-500/20',
    countKey: 'watching_count' as keyof Stats,
    tooltip: "I'm tracking this but haven't decided yet",
  },
]

const INACTIVE = 'border-slate-600/60 text-slate-400 hover:border-slate-500 hover:text-slate-300 hover:bg-slate-700/40'
const DISABLED = 'border-slate-700/40 text-slate-600 cursor-not-allowed'

function applyStanceChange(stats: Stats, prev: Stance | null, next: Stance | null): Stats {
  const updated = { ...stats }
  const key = (s: Stance): keyof Stats =>
    s === 'support' ? 'support_count'
    : s === 'oppose' ? 'oppose_count'
    : s === 'neutral' ? 'neutral_count'
    : 'watching_count'

  if (prev) updated[key(prev)] = Math.max(0, updated[key(prev)] as number - 1)
  if (next) updated[key(next)] = (updated[key(next)] as number) + 1
  return updated
}

export default function EngagementSection({
  legislationId,
  initialStats,
  initialUserStance,
  isLoggedIn,
}: {
  legislationId: string
  initialStats: Stats
  initialUserStance: Stance | null
  isLoggedIn: boolean
}) {
  const [stats, setStats] = useState<Stats>(initialStats)
  const [currentStance, setCurrentStance] = useState<Stance | null>(initialUserStance)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStance(stance: Stance) {
    if (!isLoggedIn || pending) return
    setError(null)

    const prev = currentStance
    const next = prev === stance ? null : stance
    const prevStats = stats

    // Optimistic update — drives both buttons and tally
    setCurrentStance(next)
    setStats(applyStanceChange(stats, prev, next))

    setPending(true)
    const result = await setStance(legislationId, next)
    setPending(false)

    if (result.error) {
      // Revert using captured pre-update values
      setCurrentStance(prev)
      setStats(prevStats)
      setError(result.error)
    }
  }

  const total = stats.support_count + stats.oppose_count + stats.neutral_count

  return (
    <div className="space-y-5">
      {/* ── Stance buttons ───────────────────────── */}
      <div>
        <p className="mb-2 text-xs text-slate-500">Your stance</p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Your stance">
          {STANCES.map((s) => {
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
                {s.value !== 'watching' && (
                  <span className="tabular-nums opacity-80">
                    {(stats[s.countKey] as number).toLocaleString()}
                  </span>
                )}
              </button>
            )
          })}
          {!isLoggedIn && (
            <span className="ml-1 text-xs text-slate-600">Sign in to engage</span>
          )}
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">Failed to save: {error}</p>
        )}
      </div>

      {/* ── Tally cards ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STANCES.map((s) => (
          <div
            key={s.value}
            className={`rounded-lg border p-3 ${s.tallyBg} ${s.tallyBorder}`}
          >
            <div className={`mb-1 ${s.tallyColor}`}>{s.tallyIcon}</div>
            <p className={`text-xl font-bold tabular-nums ${s.tallyColor}`}>
              {(stats[s.countKey] as number).toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Progress bar ─────────────────────────── */}
      {total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>{Math.round((stats.support_count / total) * 100)}% support</span>
            <span>{total.toLocaleString()} responses</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-700">
            <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${(stats.support_count / total) * 100}%` }} />
            <div className="bg-amber-500 transition-all duration-300" style={{ width: `${(stats.neutral_count / total) * 100}%` }} />
            <div className="bg-red-500 transition-all duration-300" style={{ width: `${(stats.oppose_count / total) * 100}%` }} />
          </div>
          <div className="mt-1 flex gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Support</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Neutral</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Oppose</span>
          </div>
        </div>
      )}

      {/* ── Comment / bookmark counts ─────────────── */}
      <div className="flex items-center gap-4 border-t border-slate-700/60 pt-4 text-sm text-slate-500">
        <span className="flex items-center gap-1.5">
          <MessageSquare size={14} />
          {stats.comment_count.toLocaleString()} comments
        </span>
        <span className="flex items-center gap-1.5">
          <Bookmark size={14} />
          {stats.bookmark_count.toLocaleString()} saves
        </span>
      </div>
    </div>
  )
}
