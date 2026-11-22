// The S1 confirmation chip: "Council District 39 · Park Slope". Client-safe.
export function addressLabel(councilDistrict: string, neighborhoodName: string | null): string {
  return [`Council District ${councilDistrict}`, neighborhoodName].filter(Boolean).join(' · ')
}
