'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, X } from 'lucide-react'

type Topic = { id: string; name: string }
type Status = string

export default function LegislationFilters({
  statuses,
  topics,
}: {
  statuses: Status[]
  topics: Topic[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''
  const type = searchParams.get('type') ?? ''
  const topicId = searchParams.get('topic_id') ?? ''
  const sort = searchParams.get('sort') ?? 'most_engaged'

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false })
      })
    },
    [router, pathname, searchParams]
  )

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname, { scroll: false })
    })
  }

  const hasFilters = q || status || type || topicId || sort !== 'most_engaged'

  return (
    <div className={`space-y-3 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      {/* Search input */}
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          type="search"
          placeholder="Search legislation..."
          defaultValue={q}
          onChange={(e) => updateParam('q', e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-4 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Dropdowns row */}
      <div className="flex flex-wrap gap-2">
        {/* Type filter */}
        <select
          value={type}
          onChange={(e) => updateParam('type', e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Types</option>
          <option value="Introduction">Introduction</option>
          <option value="Resolution">Resolution</option>
        </select>

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => updateParam('status', e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 max-w-[200px]"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Sort order */}
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value === 'most_engaged' ? '' : e.target.value)}
          className="rounded-lg border border-indigo-500/50 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="most_engaged">Most Engaged</option>
          <option value="most_recent">Most Recent</option>
        </select>

        {/* Topic filter */}
        {topics.length > 0 && (
          <select
            value={topicId}
            onChange={(e) => updateParam('topic_id', e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Topics</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {/* Clear all */}
        {hasFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            <X size={13} />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
