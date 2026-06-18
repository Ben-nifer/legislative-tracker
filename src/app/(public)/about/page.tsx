import Link from 'next/link'
import { Scale, Github } from 'lucide-react'

export const metadata = {
  title: 'About | NYC Legislative Tracker',
  description: 'About the NYC Legislative Tracker — making city council legislation accessible to every New Yorker.',
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="mb-8 flex items-center gap-3">
        <Scale size={28} className="text-nyc-orange" />
        <h1 className="text-3xl font-black uppercase tracking-widest text-white">About</h1>
      </div>

      <div className="space-y-8 text-slate-200">
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">What is this?</h2>
          <p>
            NYC Legislative Tracker is a civic engagement platform that makes New York City Council
            legislation accessible and understandable for everyday New Yorkers. Browse bills, take
            stances, follow your council member, and see what your neighbors think — all in one place.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Why we built it</h2>
          <p>
            NYC legislation affects every resident — from housing and transportation to public safety
            and education. But the official systems are dense and hard to navigate. We built this to
            lower the barrier: plain-language summaries, social context, and tools to help you
            understand what&apos;s actually being debated at City Hall.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-white">The team</h2>
          <p className="text-nyc-muted-light italic">
            [Founders — add your bios here.]
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Data</h2>
          <p>
            Legislative data is sourced from the{' '}
            <a
              href="https://legistar.council.nyc.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-nyc-orange transition-colors hover:underline"
            >
              NYC Council Legistar API
            </a>
            , which is public record. Bill summaries are generated using AI to make them more
            readable — always verify important details directly with the NYC Council.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Open source</h2>
          <p>
            This project is open source. View the code, report issues, or contribute on{' '}
            <a
              href="https://github.com/Ben-nifer/legislative-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-nyc-orange transition-colors hover:underline"
            >
              <Github size={14} />
              GitHub
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 border-t border-nyc-border/30 pt-6">
        <Link
          href="/"
          className="text-sm text-nyc-muted-light transition-colors hover:text-white"
        >
          &larr; Back to home
        </Link>
      </div>
    </div>
  )
}
