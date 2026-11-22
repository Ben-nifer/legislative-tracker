// "Council Member · District 39", "Mayor" (S3 cards). Shared by the server page and the client flow.
export function officeLine(title: string | null | undefined, district: string | null): string {
  const office = title || 'Council Member'
  return district ? `${office} · District ${district}` : office
}
