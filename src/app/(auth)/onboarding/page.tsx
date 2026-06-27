'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingForm />
    </Suspense>
  )
}

function OnboardingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.full_name) {
        setDisplayName(user.user_metadata.full_name)
      }
    })
  }, [])

  useEffect(() => {
    if (displayName && !username) {
      const suggested = displayName
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20)
      setUsername(suggested)
    }
  }, [displayName])

  async function checkUsername(value: string) {
    if (!value || value.length < 3) {
      setUsernameError('Username must be at least 3 characters')
      return
    }
    if (!/^[a-z0-9_]+$/.test(value)) {
      setUsernameError('Only lowercase letters, numbers, and underscores')
      return
    }

    const { data } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('username', value)
      .maybeSingle()

    setUsernameError(data ? 'Username is already taken' : null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (usernameError || !username || !displayName) return

    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Session expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { error: upsertError } = await supabase.from('user_profiles').upsert({
      id: user.id,
      username,
      display_name: displayName,
    })

    if (upsertError) {
      setError(upsertError.message)
      setLoading(false)
      return
    }

    router.push(next)
  }

  return (
    <div className="min-h-screen bg-nyc-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black uppercase tracking-widest text-white">Welcome!</h1>
          <p className="text-nyc-muted-light mt-1 text-sm">
            Set up your profile to get started
          </p>
        </div>

        <div className="bg-nyc-card rounded border border-nyc-border p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Display Name */}
            <div>
              <label htmlFor="displayName" className="block text-sm text-nyc-blue mb-1.5">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                required
                maxLength={50}
                className="w-full px-3 py-2.5 rounded border border-nyc-border bg-white text-nyc-blue placeholder-nyc-muted text-sm focus:outline-none focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange/30 transition-colors"
              />
            </div>

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm text-nyc-blue mb-1.5">
                Username
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nyc-muted text-sm">@</span>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                    setUsername(val)
                    setUsernameError(null)
                  }}
                  onBlur={() => checkUsername(username)}
                  placeholder="yourhandle"
                  required
                  minLength={3}
                  maxLength={30}
                  className="w-full pl-7 pr-3 py-2.5 rounded border border-nyc-border bg-white text-nyc-blue placeholder-nyc-muted text-sm focus:outline-none focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange/30 transition-colors"
                />
              </div>
              {usernameError ? (
                <p className="mt-1 text-xs text-red-500">{usernameError}</p>
              ) : username.length >= 3 ? (
                <p className="mt-1 text-xs text-emerald-600">Looks good</p>
              ) : (
                <p className="mt-1 text-xs text-nyc-muted">
                  Letters, numbers, and underscores only
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded border border-red-200 px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !!usernameError || !username || !displayName}
              className="w-full px-4 py-2.5 rounded bg-nyc-orange hover:bg-nyc-orange-hover text-white text-sm font-bold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Setting up...' : 'Get started'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
