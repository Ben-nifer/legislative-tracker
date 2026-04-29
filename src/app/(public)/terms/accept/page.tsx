import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Scale } from 'lucide-react'

export const metadata = {
  title: 'Terms of Service — NYC Legislative Tracker',
}

export default async function TermsAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = next && next.startsWith('/') ? next : '/'

  async function accept(formData: FormData) {
    'use server'
    const checked = formData.get('accepted')
    if (checked !== 'true') return

    const cookieStore = await cookies()
    cookieStore.set('terms_accepted', '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    })
    redirect(destination)
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Scale size={20} className="text-indigo-400" />
            <span className="text-lg font-semibold text-white">NYC Legislative Tracker</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
          <p className="text-slate-400 mt-1 text-sm">Please review and accept our terms to continue</p>
        </div>

        <div className="bg-slate-800/80 backdrop-blur rounded-xl border border-slate-700 p-6 space-y-5">
          <div className="rounded-lg bg-slate-900/60 border border-slate-700/60 p-4 max-h-64 overflow-y-auto text-sm text-slate-300 space-y-3">
            <p>
              <span className="font-medium text-white">NYC Legislative Tracker</span> is a civic
              engagement platform. By continuing you agree to:
            </p>
            <ul className="space-y-2 list-disc list-inside text-slate-400">
              <li>Post only civil and lawful content</li>
              <li>Not misuse the platform or another user&apos;s account</li>
              <li>Understand that legislative data is for informational purposes only</li>
              <li>Allow us to store your email and profile information to operate the service</li>
            </ul>
            <p>
              Legislative data is sourced from the NYC Council Legistar API (public record). We do
              not sell your personal data.
            </p>
            <p>
              <Link href="/terms" target="_blank" className="text-indigo-400 hover:text-indigo-300 transition-colors underline">
                Read the full Terms of Service &rarr;
              </Link>
            </p>
          </div>

          <form action={accept} className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                name="accepted"
                value="true"
                required
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800"
              />
              <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                I have read and agree to the Terms of Service
              </span>
            </label>

            <button
              type="submit"
              className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
