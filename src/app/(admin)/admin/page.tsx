import { createServerSupabaseClient } from '@/lib/supabase/server'
import { FileText, Users, MessageSquare, TrendingUp } from 'lucide-react'

export const metadata = { title: 'Admin — Overview' }
export const revalidate = 60

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabaseClient()

  const [
    { count: legislationCount },
    { count: userCount },
    { count: commentCount },
    { count: flaggedCount },
    { count: stanceCount },
  ] = await Promise.all([
    supabase.from('legislation').select('*', { count: 'exact', head: true }),
    supabase.from('user_profiles').select('*', { count: 'exact', head: true }),
    supabase.from('comments').select('*', { count: 'exact', head: true }).eq('is_hidden', false),
    supabase.from('comments').select('*', { count: 'exact', head: true }).eq('is_flagged', true).eq('is_hidden', false),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }),
  ])

  // Recent signups (last 7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: newUsers } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since)

  const stats = [
    { label: 'Legislation', value: legislationCount ?? 0, icon: FileText, color: 'text-indigo-400' },
    { label: 'Users', value: userCount ?? 0, sub: `+${newUsers ?? 0} this week`, icon: Users, color: 'text-emerald-400' },
    { label: 'Comments', value: commentCount ?? 0, icon: MessageSquare, color: 'text-blue-400' },
    { label: 'Stances taken', value: stanceCount ?? 0, icon: TrendingUp, color: 'text-purple-400' },
  ]

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Overview</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-400">{s.label}</span>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <div className={`text-3xl font-bold tabular-nums ${s.color}`}>
              {s.value.toLocaleString()}
            </div>
            {s.sub && <div className="text-xs text-slate-500 mt-1">{s.sub}</div>}
          </div>
        ))}
      </div>

      {flaggedCount !== null && flaggedCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-red-400 font-medium">{flaggedCount} flagged comment{flaggedCount !== 1 ? 's' : ''} need review</p>
            <p className="text-sm text-slate-400 mt-0.5">Visit the Moderation page to review them.</p>
          </div>
          <a href="/admin/moderation" className="text-sm text-red-400 hover:text-red-300 underline">
            Review →
          </a>
        </div>
      )}
    </div>
  )
}
