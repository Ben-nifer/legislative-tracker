// Raw shape of a NYC Open Data "Zoning Application Portal (ZAP) – Project Data"
// row (Socrata dataset hgx4-8ukb). Fields confirmed live — see V2 neighborhood-map plan.
export type ZapProject = {
  project_id: string
  project_name?: string
  project_brief?: string
  project_status?: string
  public_status?: string
  ulurp_non?: string
  actions?: string
  ceqr_type?: string
  ceqr_number?: string
  borough?: string
  community_district?: string // e.g. "X10", "Q12", "M08" — letter prefix + 2-digit number
  cc_district?: string
  mih_flag?: string
  app_filed_date?: string
  certified_referred?: string
  approval_date?: string
  completed_date?: string
  current_milestone?: string
  current_milestone_date?: string
}
