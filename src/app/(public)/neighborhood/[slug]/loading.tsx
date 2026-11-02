export default function Loading() {
  return (
    <main className="flex h-screen flex-col bg-nyc-bg">
      <div className="border-b border-nyc-border bg-nyc-blue px-4 py-4 sm:px-6">
        <div className="h-6 w-56 animate-pulse rounded bg-white/10" />
        <div className="mt-2 h-3 w-72 animate-pulse rounded bg-white/10" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="h-[50vh] w-full animate-pulse bg-nyc-card-hover lg:h-full lg:w-3/5" />
        <div className="flex-1 space-y-3 border-t border-nyc-border p-4 lg:border-l lg:border-t-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded border border-nyc-border bg-nyc-card p-4 space-y-3">
              <div className="flex gap-2">
                <div className="h-5 w-20 animate-pulse rounded bg-nyc-border" />
                <div className="h-5 w-16 animate-pulse rounded bg-nyc-border" />
              </div>
              <div className="h-4 w-full animate-pulse rounded bg-nyc-border" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-nyc-border" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
