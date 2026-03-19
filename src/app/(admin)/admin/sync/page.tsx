'use client'

import { useState } from 'react'
import { RefreshCw, Sparkles, BarChart2 } from 'lucide-react'

type JobState = 'idle' | 'running' | 'done' | 'error'

interface JobResult {
  message?: string
  processed?: number
  failed?: number
  remaining?: number
  error?: string
  [key: string]: unknown
}

function useJob(url: string, method = 'POST') {
  const [state, setState] = useState<JobState>('idle')
  const [result, setResult] = useState<JobResult | null>(null)

  async function run() {
    setState('running')
    setResult(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}` },
      })
      const json = await res.json()
      setResult(json)
      setState(res.ok ? 'done' : 'error')
    } catch (e) {
      setResult({ error: String(e) })
      setState('error')
    }
  }

  return { state, result, run }
}

export default function SyncPage() {
  const sync = useJob('/api/cron/sync-legislation')
  const stats = useJob('/api/cron/refresh-stats')
  const summaries = useJob('/api/admin/generate-summaries')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Data Sync</h1>

      {[
        {
          title: 'Sync Legislation',
          description: 'Pull latest bills and resolutions from the NYC Council Legistar API.',
          icon: RefreshCw,
          job: sync,
          color: 'indigo',
        },
        {
          title: 'Refresh Stats',
          description: 'Recalculate trending scores, engagement counts, and view totals.',
          icon: BarChart2,
          job: stats,
          color: 'emerald',
        },
        {
          title: 'Generate AI Summaries',
          description: 'Generate plain-language summaries for legislation that doesn\'t have one yet (batch of 10).',
          icon: Sparkles,
          job: summaries,
          color: 'purple',
        },
      ].map(({ title, description, icon: Icon, job, color }) => (
        <div key={title} className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-${color}-500/10`}>
                <Icon className={`w-5 h-5 text-${color}-400`} />
              </div>
              <div>
                <h2 className="font-semibold text-white">{title}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{description}</p>
              </div>
            </div>
            <button
              onClick={job.run}
              disabled={job.state === 'running'}
              className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
            >
              {job.state === 'running' && (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              )}
              {job.state === 'running' ? 'Running…' : 'Run now'}
            </button>
          </div>

          {job.result && (
            <div className={`text-xs rounded-lg p-3 font-mono ${job.state === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-slate-900/60 text-slate-300'}`}>
              {JSON.stringify(job.result, null, 2)}
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-slate-600">
        These jobs also run automatically on schedule via Vercel cron. Manual triggers are for testing or catching up after downtime.
      </p>
    </div>
  )
}
