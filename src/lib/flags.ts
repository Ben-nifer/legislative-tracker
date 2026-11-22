// Launch switches (onboarding-build-planv1.1.md §3.2). Env vars, so changing one
// needs a redeploy. Each variable must be read by its literal name for Next.js
// to inline it into client bundles.

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

export const flags = {
  // /welcome, the `/` → /welcome redirect, and the widget home page
  newOnboarding: envFlag(process.env.NEXT_PUBLIC_FLAG_NEW_ONBOARDING, false),
  // Kill switches for onboarding S3 and S4 (spec §S3, §S4)
  stepPoliticians: envFlag(process.env.NEXT_PUBLIC_FLAG_STEP_POLITICIANS, true),
  stepInterests: envFlag(process.env.NEXT_PUBLIC_FLAG_STEP_INTERESTS, true),
} as const
