import { createServerSupabaseClient } from '@/lib/supabase/server'
import { formatDistanceToNow } from 'date-fns'
import { hideComment, clearFlag } from './actions'

export const metadata = { title: 'Admin — Moderation' }
export const revalidate = 0

export default async function ModerationPage() {
  const supabase = await createServerSupabaseClient()

  const { data: flagged } = await supabase
    .from('comments')
    .select(`
      id, body, created_at, is_hidden,
      user:user_profiles(username, display_name),
      legislation(file_number, slug, title)
    `)
    .eq('is_flagged', true)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Moderation Queue</h1>
        <p className="text-slate-400 text-sm mt-1">
          {flagged?.length ?? 0} flagged comment{flagged?.length !== 1 ? 's' : ''} awaiting review
        </p>
      </div>

      {!flagged?.length && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center text-slate-500">
          No flagged comments. Queue is clear.
        </div>
      )}

      <div className="space-y-3">
        {flagged?.map((comment) => {
          const user = Array.isArray(comment.user) ? comment.user[0] : comment.user
          const leg = Array.isArray(comment.legislation) ? comment.legislation[0] : comment.legislation
          return (
            <div key={comment.id} className="bg-slate-800/80 border border-red-500/20 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-white">
                    @{user?.username ?? 'unknown'}
                  </span>
                  <span className="text-slate-500 text-xs ml-2">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </span>
                  {leg && (
                    <a
                      href={`/legislation/${leg.slug}`}
                      className="block text-xs text-indigo-400 hover:underline mt-0.5"
                    >
                      {leg.file_number} — {leg.title?.slice(0, 60)}…
                    </a>
                  )}
                </div>
                <span className="shrink-0 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Flagged</span>
              </div>

              <p className="text-slate-300 text-sm bg-slate-900/60 rounded-lg p-3 whitespace-pre-wrap">
                {comment.body}
              </p>

              <div className="flex gap-2">
                <form action={hideComment.bind(null, comment.id)}>
                  <button
                    type="submit"
                    className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Hide comment
                  </button>
                </form>
                <form action={clearFlag.bind(null, comment.id)}>
                  <button
                    type="submit"
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Clear flag (keep)
                  </button>
                </form>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
