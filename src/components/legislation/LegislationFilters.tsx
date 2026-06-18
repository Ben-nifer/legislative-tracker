'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, X } from 'lucide-react'

type Committee = { id: string; name: string }
type Status = string

export default function LegislationFilters({
  statuses,
  committees,
}: {
  statuses: Status[]
  committees: Committee[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''
  const committeeId = searchParams.get('committee_id') ?? ''
  const sort = searchParams.get('sort') ?? 'most_engaged'

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete('page')
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

  const hasFilters = q || status || committeeId || sort !== 'most_engaged'

  const selectClass = 'rounded border border-nyc-border bg-nyc-card px-3 py-2 text-sm text-nyc-blue outline-none transition-colors focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange'

  return (
    <div className={`space-y-3 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      {/* Search input */}
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nyc-muted"
        />
        <input
          type="search"
          placeholder="Search legislation or bill number…"
          defaultValue={q}
          onChange={(e) => updateParam('q', e.target.value)}
          className="w-full rounded border border-nyc-border bg-nyc-card py-2 pl-9 pr-4 text-sm text-nyc-blue placeholder-nyc-muted outline-none transition-colors focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange"
        />
      </div>

      {/* Dropdowns row */}
      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => updateParam('status', e.target.value)}
          className={`${selectClass} max-w-[200px]`}
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value === 'most_engaged' ? '' : e.target.value)}
          className={`${selectClass} border-nyc-orange/50 text-nyc-orange`}
        >
          <option value="most_engaged">Most Engaged</option>
          <option value="most_recent">Most Recent</option>
        </select>

        {committees.length > 0 && (
          <select
            value={committeeId}
            onChange={(e) => updateParam('committee_id', e.target.value)}
            className={selectClass}
          >
            <option value="">All Committees</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 rounded border border-nyc-border bg-nyc-card px-3 py-2 text-sm text-nyc-muted transition-colors hover:border-nyc-blue hover:bg-nyc-blue hover:text-white"
          >
            <X size={13} />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
