'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Search } from 'lucide-react'
import { resolveNeighborhoodDistrict } from '@/app/actions/profile'

export default function NeighborhoodLookup() {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return
    setLoading(true)
    setError(null)

    const res = await resolveNeighborhoodDistrict(address.trim())
    setLoading(false)

    if (res.error) {
      setError(res.error)
    } else if (res.slug) {
      router.push(`/neighborhood/${res.slug}`)
    }
  }

  return (
    <div className="rounded-xl border border-nyc-border bg-nyc-card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-nyc-blue">
        <MapPin size={15} className="text-nyc-orange" />
        What&apos;s Happening In Your Neighborhood
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
            <><Search size={13} /> See What&apos;s Happening</>
          )}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
