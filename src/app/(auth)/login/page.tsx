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

  async function handleGoogleLogin() {
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    if (error) {
      setLoading(false)
      setError(error.message)
    }
  }

  return (
    <div className="min-h-screen bg-nyc-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black uppercase tracking-widest text-white">NYC Legislative Tracker</h1>
          <p className="text-nyc-muted-light mt-1 text-sm">
            Track NYC legislation that matters to you
          </p>
        </div>

        <div className="bg-nyc-card rounded border border-nyc-border p-6 space-y-5">
          <h2 className="text-lg font-bold text-nyc-blue">Sign in</h2>

          {authError === 'auth_failed' && (
            <p className="text-sm text-red-600 bg-red-50 rounded border border-red-200 px-3 py-2">
              Authentication failed. Please try again.
            </p>
          )}

          {/* Google OAuth */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded border border-nyc-border bg-nyc-card text-nyc-blue text-sm font-medium hover:bg-nyc-card-hover hover:border-nyc-border-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-nyc-border" />
            <span className="text-xs text-nyc-muted">or</span>
            <div className="flex-1 h-px bg-nyc-border" />
          </div>

          {/* Magic Link */}
          {sent ? (
            <div className="text-center space-y-2">
              <div className="text-2xl">📬</div>
              <p className="text-nyc-blue font-medium text-sm">Check your email</p>
              <p className="text-nyc-muted text-sm">
                We sent a magic link from{' '}
                <span className="text-nyc-blue">noreply@legislative-tracker.com</span>{' '}
                to <span className="text-nyc-blue font-medium">{email}</span>.
                Check your spam folder if it doesn&apos;t arrive within a minute.
              </p>
              <button
                onClick={() => setSent(false)}
                className="text-nyc-orange hover:underline text-sm transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div>
                <label htmlFor="email" className="block text-sm text-nyc-blue mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-3 py-2.5 rounded border border-nyc-border bg-white text-nyc-blue placeholder-nyc-muted text-sm focus:outline-none focus:border-nyc-orange focus:ring-1 focus:ring-nyc-orange/30 transition-colors"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full px-4 py-2.5 rounded bg-nyc-orange hover:bg-nyc-orange-hover text-white text-sm font-bold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-nyc-muted-light mt-6">
          By signing in, you agree to our{' '}
          <a href="/terms" className="text-nyc-muted-light hover:text-white transition-colors">Terms</a>
          {' '}and{' '}
          <a href="/privacy" className="text-nyc-muted-light hover:text-white transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  )
}
