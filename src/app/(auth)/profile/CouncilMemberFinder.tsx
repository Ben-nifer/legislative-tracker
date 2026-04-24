'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Search, RefreshCw, Check, X } from 'lucide-react'
import MemberAvatar from '@/components/council/MemberAvatar'
import { lookupAddressDistrict, saveCouncilMember } from '@/app/actions/profile'

type Legislator = {
  id: string
  full_name: string
  slug: string
  district: number
  borough: string | null
  photo_url: string | null
}

export default function CouncilMemberFinder({
  initialMember,
  initialCommunityBoard,
}: {
  initialMember: Legislator | null
  initialCommunityBoard: string | null
}) {
  const [member, setMember] = useState<Legislator | null>(initialMember)
  const [communityBoard, setCommunityBoard] = useState<string | null>(initialCommunityBoard)
  const [showLookup, setShowLookup] = useState(false)
  const [address, setAddress] = useState('')
  const [result, setResult] = useState<{ legislator?: Legislator; communityBoard?: string } | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return
    setLoading(true)
    setLookupError(null)
    setResult(null)

    const res = await lookupAddressDistrict(address.trim())
    setLoading(false)

    if (res.error) {
      setLookupError(res.error)
    } else {
      setResult({ legislator: res.legislator, communityBoard: res.communityBoard })
    }
  }

  async function handleSave() {
    if (!result?.legislator) return
    setSaving(true)
    const res = await saveCouncilMember(result.legislator.id, result.communityBoard ?? null)
    setSaving(false)

    if (res.error) {
      setLookupError(res.error)
    } else {
      setMember(result.legislator)
      setCommunityBoard(result.communityBoard ?? null)
      setShowLookup(false)
      setAddress('')
      setResult(null)
    }
  }

  function handleCancel() {
    setShowLookup(false)
    setAddress('')
    setResult(null)
    setLookupError(null)
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
        <MapPin size={16} className="text-indigo-400" />
        My Council Member
      </h2>

      {/* Current council member */}
      {member && !showLookup && (
        <div className="flex items-start gap-4">
          <MemberAvatar name={member.full_name} photoUrl={member.photo_url} size="md" />
          <div className="flex-1 min-w-0">
            <Link
              href={`/council-members/${member.slug}`}
              className="font-medium text-white hover:text-indigo-300 transition-colors"
            >
              {member.full_name}
            </Link>
            <p className="text-sm text-slate-500 mt-0.5">
              District {member.district}
              {member.borough ? ` · ${member.borough}` : ''}
            </p>
            {communityBoard && (
              <p className="text-sm text-slate-500">{communityBoard}</p>
            )}
          </div>
          <button
            onClick={() => setShowLookup(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            <RefreshCw size={12} /> Update
          </button>
        </div>
      )}

      {/* No council member set yet */}
      {!member && !showLookup && (
        <div className="text-center py-2">
          <p className="text-sm text-slate-400 mb-3">
            Find your council member by entering your address.
          </p>
          <button
            onClick={() => setShowLookup(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
          >
            <Search size={14} /> Find My Council Member
          </button>
        </div>
      )}

      {/* Address lookup form */}
      {showLookup && (
        <div className="space-y-4">
          <form onSubmit={handleLookup} className="flex gap-2">
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Enter your NYC street address"
              required
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !address.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="animate-pulse">Looking up…</span>
              ) : (
                <><Search size={14} /> Look Up</>
              )}
            </button>
          </form>

          {lookupError && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{lookupError}</p>
          )}

          {/* Result */}
          {result?.legislator && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <MemberAvatar name={result.legislator.full_name} photoUrl={result.legislator.photo_url} size="sm" />
                <div>
                  <p className="font-medium text-white">{result.legislator.full_name}</p>
                  <p className="text-sm text-slate-500">
                    District {result.legislator.district}
                    {result.legislator.borough ? ` · ${result.legislator.borough}` : ''}
                  </p>
                  {result.communityBoard && (
                    <p className="text-sm text-slate-500">{result.communityBoard}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
                >
                  <Check size={14} /> {saving ? 'Saving…' : 'Save to my profile'}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
                >
                  <X size={14} /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Cancel without result */}
          {!result && (
            <button
              onClick={handleCancel}
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
