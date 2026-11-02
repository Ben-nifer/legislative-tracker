// Raw shape of a NYC Open Data "Street and Highway Capital Reconstruction
// Projects" row (Socrata dataset jvk9-k4re, block-level). Despite the dataset
// name this covers multiple agencies' capital construction along the
// roadway (DOT, DEP, etc.) — see Open Question 3 in the V2 neighborhood-map
// plan. Field names confirmed live, not guessed.
export type DotCapitalProject = {
  projectid: string
  projtitle?: string
  leadagency?: string
  managingag?: string
  projecttyp?: string
  projectt_1?: string // human-readable project type description
  projectsta?: string // status
  constructi?: string // construction fiscal year
  projectcos?: string
  overallsco?: string
  onstreetna?: string
  fromstreet?: string
  tostreetna?: string
  boroughnam?: string
  the_geom: {
    type: 'MultiLineString' | 'LineString'
    coordinates: unknown
  }
}
