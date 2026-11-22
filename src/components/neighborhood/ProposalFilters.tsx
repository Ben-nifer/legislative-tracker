'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { X } from 'lucide-react'

export default function ProposalFilters({
  statuses,
}: {
  statuses: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const status = searchParams.get('status') ?? ''
  const family = searchParams.get('family') ?? ''
  const sort = searchParams.get('sort') ?? 'most_engaged'
  const pendingOnly = searchParams.get('pending') === '1'

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

  const hasFilters = status || family || sort !== 'most_engaged' || pendingOnly

  const selectClass = 'rounded border border-nyc-border bg-nyc-card px-3 py-2 text-sm text-nyc-blue outline-none transition-colors focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange'

  return (
    <div className={`flex flex-wrap gap-2 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      <select
        value={sort}
        onChange={(e) => updateParam('sort', e.target.value === 'most_engaged' ? '' : e.target.value)}
        className={`${selectClass} border-nyc-orange/50 text-nyc-orange`}
      >
        <option value="most_engaged">Most Engaged</option>
        <option value="most_recent">Most Recent</option>
      </select>

      <select
        value={family}
        onChange={(e) => updateParam('family', e.target.value)}
        className={selectClass}
      >
        <option value="">All Types</option>
        <option value="ulurp">ULURP (Housing/Rezoning)</option>
        <option value="dot">DOT (Street/Capital)</option>
      </select>

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

      <label
        className={[
          'flex items-center gap-1.5 rounded border px-3 py-2 text-sm cursor-pointer transition-colors',
          pendingOnly
            ? 'border-nyc-orange/60 bg-nyc-orange/15 text-nyc-orange'
            : 'border-nyc-border bg-nyc-card text-nyc-muted hover:border-nyc-border-light',
        ].join(' ')}
      >
        <input
          type="checkbox"
          checked={pendingOnly}
          onChange={(e) => updateParam('pending', e.target.checked ? '1' : '')}
          className="accent-nyc-orange"
        />
        Pending only
      </label>

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
  )
}
