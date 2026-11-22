'use client'

import {
  GUEST_CONTEXT_COOKIE,
  emptyGuestContext,
  parseGuestContext,
  serializeGuestContext,
  type GuestContext,
} from './guest'
import {
  PENDING_ACTION_COOKIE,
  PENDING_ACTION_MAX_AGE_SECONDS,
  serializePendingAction,
  type PendingAction,
} from './session'

// Browser-side writers for the onboarding cookies (build plan §3.3, §4.3).
// No Max-Age on the guest context: it's a session cookie, gone when the browser closes.

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(prefix))
    ?.slice(prefix.length)
}

function writeCookie(name: string, value: string, maxAgeSeconds?: number) {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax']
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (location.protocol === 'https:') parts.push('Secure')
  document.cookie = parts.join('; ')
}

export function readGuestContext(): GuestContext {
  return parseGuestContext(readCookie(GUEST_CONTEXT_COOKIE)) ?? emptyGuestContext()
}

// Returns false when the context is over the size cap; the caller keeps the
// previous selection and tells the user they've hit the limit.
export function writeGuestContext(ctx: GuestContext): boolean {
  try {
    writeCookie(GUEST_CONTEXT_COOKIE, serializeGuestContext(ctx))
    return true
  } catch {
    return false
  }
}

export function clearGuestContext() {
  writeCookie(GUEST_CONTEXT_COOKIE, '', 0)
}

export function setPendingAction(action: PendingAction) {
  writeCookie(PENDING_ACTION_COOKIE, serializePendingAction(action), PENDING_ACTION_MAX_AGE_SECONDS)
}
