'use client'

import { MAX_EVENTS_PER_BATCH, validateEvent, type EventName, type EventProps } from './events'

// Client-side batching for spec §11 events (build plan §4.7): flushed every few
// seconds and when the page is hidden. Invalid events are dropped here and again
// on the server.

const FLUSH_INTERVAL_MS = 4000
const ENDPOINT = '/api/events'

const queue: { name: EventName; props: unknown }[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let listening = false

function flush(useBeacon = false) {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  while (queue.length) {
    const body = JSON.stringify({ events: queue.splice(0, MAX_EVENTS_PER_BATCH) })
    if (useBeacon && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) continue
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(
      () => {} // analytics are best-effort
    )
  }
}

function listen() {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
  window.addEventListener('pagehide', () => flush(true))
}

export function track<N extends EventName>(name: N, props: EventProps<N>) {
  if (typeof window === 'undefined') return
  if (!validateEvent({ name, props })) {
    if (process.env.NODE_ENV !== 'production') console.warn(`track: rejected ${name}`, props)
    return
  }
  listen()
  queue.push({ name, props })
  if (queue.length >= MAX_EVENTS_PER_BATCH) flush()
  else if (!timer) timer = setTimeout(() => flush(), FLUSH_INTERVAL_MS)
}
