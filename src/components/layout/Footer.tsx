import Link from 'next/link'
import { Scale } from 'lucide-react'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-slate-800 bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-3">

          {/* Column 1: Brand */}
          <div>
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-indigo-400" />
              <span className="text-sm font-semibold text-white">NYC Legislative Tracker</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Making NYC legislation accessible.</p>
          </div>

          {/* Column 2: Browse */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Browse</p>
            <ul className="space-y-2">
              {[
                { href: '/legislation', label: 'Legislation' },
                { href: '/trending', label: 'Trending' },
                { href: '/council-members', label: 'Council Members' },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-400 transition-colors hover:text-slate-200"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Resources */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Resources</p>
            <ul className="space-y-2">
              <li>
                <Link href="#" className="text-sm text-slate-400 transition-colors hover:text-slate-200">
                  About
                </Link>
              </li>
              <li>
                <Link href="#" className="text-sm text-slate-400 transition-colors hover:text-slate-200">
                  GitHub
                </Link>
              </li>
              <li>
                <a
                  href="https://legistar.council.nyc.gov"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-400 transition-colors hover:text-slate-200"
                >
                  Data from NYC Council
                </a>
              </li>
            </ul>
          </div>

        </div>

        {/* Bottom bar */}
        <div className="mt-10 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
          Data sourced from NYC Council Legistar API · © {year}
        </div>
      </div>
    </footer>
  )
}
