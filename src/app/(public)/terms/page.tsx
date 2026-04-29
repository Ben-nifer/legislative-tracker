import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service — NYC Legislative Tracker',
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
      <p className="text-slate-400 text-sm mb-10">Last updated: April 2025</p>

      <div className="prose prose-invert prose-slate max-w-none space-y-8 text-slate-300">

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">1. About This Platform</h2>
          <p>
            NYC Legislative Tracker is a civic engagement tool that helps New Yorkers follow,
            understand, and share opinions on New York City Council legislation. By using this
            platform you agree to these terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">2. Accounts</h2>
          <p>
            You may browse legislation without an account. Creating an account lets you take stances,
            leave comments, and follow bills. You are responsible for keeping your login credentials
            secure and for all activity under your account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">3. User Content</h2>
          <p>
            Comments and other content you post must be civil and lawful. You may not post content
            that is defamatory, threatening, obscene, or in violation of any law. We reserve the
            right to remove content and suspend accounts that violate these standards.
          </p>
          <p className="mt-2">
            By posting content you grant us a non-exclusive, royalty-free license to display it on
            the platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">4. Data & Privacy</h2>
          <p>
            We collect the minimum data necessary to operate the platform, including your email
            address and any profile information you choose to provide. Legislative data is sourced
            from the NYC Council Legistar API and is public record. We do not sell your personal
            data to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">5. Accuracy of Legislative Data</h2>
          <p>
            Legislative information on this platform is provided for informational purposes only and
            may not reflect the most current status of a bill. Always verify important information
            directly with the{' '}
            <a
              href="https://legistar.council.nyc.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              NYC Council Legistar system
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">6. Limitation of Liability</h2>
          <p>
            This platform is provided &ldquo;as is&rdquo; without warranties of any kind. We are
            not liable for any inaccuracies in legislative data or for any damages arising from your
            use of the platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">7. Changes to These Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the platform after changes
            are posted constitutes acceptance of the revised terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">8. Contact</h2>
          <p>
            Questions about these terms? Reach out via the{' '}
            <a
              href="https://github.com/legislative-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              GitHub repository
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-slate-800">
        <Link
          href="/"
          className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          &larr; Back to home
        </Link>
      </div>
    </div>
  )
}
