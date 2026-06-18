'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Search } from 'lucide-react'
import MemberAvatar from '@/components/council/MemberAvatar'
import { lookupAddressDistrict } from '@/app/actions/profile'

type Legislator = {
  id: string
  full_name: string
  slug: string
  district: number
  borough: string | null
  photo_url: string | null
}

export default function CouncilMemberLookup() {
  const [address, setAddress] = useState('')
  const [result, setResult] = useState<{ legislator?: Legislator; communityBoard?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    const res = await lookupAddressDistrict(address.trim())
    setLoading(false)

    if (res.error) {
      setError(res.error)
    } else {
      setResult({ legislator: res.legislator, communityBoard: res.communityBoard })
    }
  }

  return (
    <div className="rounded-xl border border-nyc-border bg-nyc-card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-nyc-blue">
        <MapPin size={15} className="text-nyc-orange" />
        Find Your Council Member
      </h3>

      <form onSubmit={handleLookup} className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter your NYC street address"
          required
          className="flex-1 rounded border border-nyc-border bg-white px-3 py-2 text-sm text-nyc-blue placeholder-nyc-muted transition-colors focus:border-nyc-orange focus:outline-none focus:ring-1 focus:ring-nyc-orange"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="flex items-center gap-1.5 rounded bg-nyc-orange px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-nyc-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <span className="animate-pulse">Looking up…</span>
          ) : (
            <><Search size={13} /> Look Up</>
          )}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {result?.legislator && (
        <div className="mt-3 flex items-center gap-3 rounded border border-nyc-border bg-nyc-card-hover p-3">
          <MemberAvatar name={result.legislator.full_name} photoUrl={result.legislator.photo_url} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-nyc-blue">{result.legislator.full_name}</p>
            <p className="text-xs text-nyc-muted">
              District {result.legislator.district}
              {result.legislator.borough ? ` · ${result.legislator.borough}` : ''}
              {result.communityBoard ? ` · ${result.communityBoard}` : ''}
            </p>
          </div>
          <Link
            href={`/council-members/${result.legislator.slug}`}
            className="shrink-0 rounded border border-nyc-blue/30 px-3 py-1.5 text-xs font-bold text-nyc-blue transition-colors hover:bg-nyc-blue hover:text-white"
          >
            View profile →
          </Link>
        </div>
      )}
    </div>
  )
}
