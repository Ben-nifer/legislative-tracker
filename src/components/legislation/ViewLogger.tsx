'use client'

import { useEffect } from 'react'
import { logEngagement } from '@/app/actions/engagement'

/**
 * Silently logs a 'view' engagement event when a legislation detail page loads.
 * Renders nothing — purely a side-effect component.
 */
export default function ViewLogger({ legislationId }: { legislationId: string }) {
  useEffect(() => {
    logEngagement(legislationId, 'view')
  }, [legislationId])

  return null
}
