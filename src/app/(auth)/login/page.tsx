'use client'

import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const authError = searchParams.get('error')

  const supabase = createClient()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Legislative Tracker</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Track NYC legislation that matters to you
          </p>
        </div>

        <div className="bg-slate-800/80 backdrop-blur rounded-xl border border-slate-700 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">Sign in</h2>

          {authError === 'auth_failed' && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              Authentication failed. Please try again.
            </p>
          )}

          {/* Magic Link */}
          {sent ? (
            <div className="text-center space-y-2">
              <div className="text-2xl">📬</div>
              <p className="text-white font-medium text-sm">Check your email</p>
              <p className="text-slate-400 text-sm">
                We sent a magic link from{' '}
                <span className="text-slate-300">noreply@legislative-tracker.com</span>{' '}
                to <span className="text-white">{email}</span>.
                Check your spam folder if it doesn&apos;t arrive within a minute.
              </p>
              <button
                onClick={() => setSent(false)}
                className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div>
                <label htmlFor="email" className="block text-sm text-slate-300 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          By signing in, you agree to our{' '}
          <a href="/terms" className="text-slate-400 hover:text-white transition-colors">Terms</a>
          {' '}and{' '}
          <a href="/privacy" className="text-slate-400 hover:text-white transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}

