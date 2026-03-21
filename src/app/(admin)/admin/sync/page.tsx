'use client'

import { useState } from 'react'
import { RefreshCw, Sparkles, BarChart2, Tag, Users } from 'lucide-react'
import { generateSummariesBatch, seedTopics, runSyncSponsorships } from '@/app/actions/admin'

function SponsorshipsCard() {
  const [state, setState] = useState<JobState>('idle')
  const [log, setLog] = useState<string[]>([])
  const [autoRun, setAutoRun] = useState(false)
  const autoRunRef = { current: false }

  async function runOnce(offset: number): Promise<{ nextOffset: number; done: boolean }> {
    const res = await runSyncSponsorships(offset)
    setLog((prev) => [
      `offset ${offset}/${res.total} — found ${res.sponsorsFound} sponsors, synced ${res.synced}, unmatched ${res.unmatched}${res.apiFailed > 0 ? `, apiFailed ${res.apiFailed}` : ''}${res.error ? ` — ${res.error}` : ''}`,
      ...prev.slice(0, 19),
    ])
    return { nextOffset: res.offset, done: res.done }
  }

  async function runAll() {
    setState('running')
    setLog([])
    autoRunRef.current = true
    setAutoRun(true)
    try {
      let offset = 0
      let done = false
      while (autoRunRef.current && !done) {
        const result = await runOnce(offset)
        offset = result.nextOffset
        done = result.done
      }
      setState('done')
    } catch (e) {
      setLog((prev) => [`✗ error: ${String(e)}`, ...prev])
      setState('error')
    }
    setAutoRun(false)
  }

  function stop() {
    autoRunRef.current = false
  }

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <Users className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Sync Sponsorships</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Links council members to the bills they sponsor. Processes 30 bills per batch.
              &ldquo;Run all&rdquo; keeps going until every bill is processed.
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {autoRun ? (
            <button
              onClick={stop}
              className="text-sm bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={() => runOnce(0)}
                disabled={state === 'running'}
                className="text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Run once
              </button>
              <button
                onClick={runAll}
                disabled={state === 'running'}
                className="text-sm bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                Run all
              </button>
            </>
          )}
        </div>
      </div>

      {autoRun && (
        <div className="flex items-center gap-2 text-sm text-indigo-300">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Running continuously — click Stop to pause
        </div>
      )}

      {log.length > 0 && (
        <div className="text-xs rounded-lg p-3 font-mono bg-slate-900/60 text-slate-300 space-y-1 max-h-48 overflow-y-auto">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}

type JobState = 'idle' | 'running' | 'done' | 'error'
type JobResult = Record<string, unknown>

function JobCard({
  title,
  description,
  icon: Icon,
  color,
  onRun,
}: {
  title: string
  description: string
  icon: React.ElementType
  color: string
  onRun: () => Promise<JobResult>
}) {
  const [state, setState] = useState<JobState>('idle')
  const [result, setResult] = useState<JobResult | null>(null)

  async function run() {
    setState('running')
    setResult(null)
    try {
      const res = await onRun()
      setResult(res)
      setState('error' in res && res.error ? 'error' : 'done')
    } catch (e) {
      setResult({ error: String(e) })
      setState('error')
    }
  }

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
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
          onClick={run}
          disabled={state === 'running'}
          className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          {state === 'running' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          {state === 'running' ? 'Running…' : 'Run now'}
        </button>
      </div>

      {result && (
        <div
          className={`text-xs rounded-lg p-3 font-mono whitespace-pre-wrap ${
            state === 'error'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-slate-900/60 text-slate-300'
          }`}
        >
          {JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  )
}

function CronJobCard({
  title,
  description,
  icon: Icon,
  color,
  url,
  method,
}: {
  title: string
  description: string
  icon: React.ElementType
  color: string
  url: string
  method?: string
}) {
  const [state, setState] = useState<JobState>('idle')
  const [result, setResult] = useState<JobResult | null>(null)

  async function run() {
    setState('running')
    setResult(null)
    try {
      const res = await fetch(url, {
        method: method ?? 'GET',
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

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
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
          onClick={run}
          disabled={state === 'running'}
          className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          {state === 'running' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          {state === 'running' ? 'Running…' : 'Run now'}
        </button>
      </div>

      {result && (
        <div
          className={`text-xs rounded-lg p-3 font-mono whitespace-pre-wrap ${
            state === 'error'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-slate-900/60 text-slate-300'
          }`}
        >
          {JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  )
}

function SummariesCard() {
  const [state, setState] = useState<JobState>('idle')
  const [log, setLog] = useState<string[]>([])
  const [autoRun, setAutoRun] = useState(false)
  const autoRunRef = { current: false }

  async function runOnce(): Promise<number> {
    const res = await generateSummariesBatch()
    const remaining = res.remaining ?? 0
    setLog((prev) => [
      `✓ processed ${res.processed}, failed ${res.failed}, remaining ${remaining}`,
      ...prev.slice(0, 19),
    ])
    return remaining
  }

  async function runAll() {
    setState('running')
    setLog([])
    autoRunRef.current = true
    setAutoRun(true)
    try {
      let remaining = Infinity
      while (autoRunRef.current && remaining > 0) {
        remaining = await runOnce()
      }
      setState('done')
    } catch (e) {
      setLog((prev) => [`✗ error: ${String(e)}`, ...prev])
      setState('error')
    }
    setAutoRun(false)
  }

  function stop() {
    autoRunRef.current = false
  }

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Sparkles className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Generate AI Summaries & Topics</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Generates summaries and assigns topics for 25 bills at a time using Haiku.
              "Run all" keeps going until every bill is processed.
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {autoRun ? (
            <button
              onClick={stop}
              className="text-sm bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={runOnce}
                disabled={state === 'running'}
                className="text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Run once
              </button>
              <button
                onClick={runAll}
                disabled={state === 'running'}
                className="text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                Run all
              </button>
            </>
          )}
        </div>
      </div>

      {autoRun && (
        <div className="flex items-center gap-2 text-sm text-purple-300">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Running continuously — click Stop to pause
        </div>
      )}

      {log.length > 0 && (
        <div className="text-xs rounded-lg p-3 font-mono bg-slate-900/60 text-slate-300 space-y-1 max-h-48 overflow-y-auto">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SyncPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Data Sync</h1>

      <div className="space-y-4">
        {/* Step 0: Seed topics — run once */}
        <JobCard
          title="Seed Topics"
          description="Create the predefined topic categories (Housing, Transportation, Health, etc.). Run this once before generating summaries."
          icon={Tag}
          color="amber"
          onRun={async () => {
            const res = await seedTopics()
            return res as Record<string, unknown>
          }}
        />

        {/* Sync sponsorships */}
        <SponsorshipsCard />

        {/* Sync legislation from Legistar */}
        <CronJobCard
          title="Sync Legislation"
          description="Pull latest bills and resolutions from the NYC Council Legistar API."
          icon={RefreshCw}
          color="indigo"
          url="/api/cron/sync-legislation"
        />

        {/* Refresh stats */}
        <CronJobCard
          title="Refresh Stats"
          description="Recalculate trending scores, engagement counts, and view totals."
          icon={BarChart2}
          color="emerald"
          url="/api/cron/refresh-stats"
        />

        {/* Generate summaries + topics */}
        <SummariesCard />
      </div>

      <p className="text-xs text-slate-600">
        Sync and Refresh Stats also run automatically on schedule via Vercel cron.
        Manual triggers are for testing or catching up after downtime.
      </p>
    </div>
  )
}
