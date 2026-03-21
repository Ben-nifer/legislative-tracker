// Raw types returned by the NYC Council Legistar API

export interface LegistarMatterSponsor {
  MatterSponsorId: number
  MatterSponsorMatterId: number
  MatterSponsorNameId: number   // PersonId of the sponsor
  MatterSponsorName: string     // Full name of the sponsor
  MatterSponsorSequence: number // 1 = primary sponsor
}

export interface LegistarMatter {
  MatterId: number
  MatterFile: string         // e.g. "Int 0001-2024"
  MatterName: string
  MatterTitle: string
  MatterTypeName: string     // "Introduction", "Resolution", etc.
  MatterStatusName: string   // "Committee", "Enacted", "Filed", etc.
  MatterBodyName: string     // Committee name
  MatterIntroDate: string    // ISO date string (may be "0001-01-01..." for null)
  MatterAgendaDate: string   // Last agenda/action date
  MatterPassedDate: string
  MatterEnactmentDate: string
  MatterText1: string        // Official summary/description
  MatterSponsors?: LegistarMatterSponsor[]  // Populated when $expand=MatterSponsors is used
}

export interface LegistarPerson {
  PersonId: number
  PersonFullName: string
  PersonActiveFlag: number   // 1 = active, 0 = inactive
  PersonEmail: string
  PersonPhone: string
  PersonWWW: string
  PersonPhotoFileName: string | null  // filename for photo, e.g. "12345.jpg"
}

export interface LegistarOfficeRecord {
  OfficeRecordId: number
  OfficeRecordPersonId: number
  OfficeRecordBodyName: string  // "City Council"
  OfficeRecordTitle: string     // "Council Member", "Speaker", etc.
  OfficeRecordStartDate: string
  OfficeRecordEndDate: string
}

export interface LegistarSponsor {
  MatterSponsorId: number
  MatterSponsorMatterId: number
  MatterSponsorNameId: number
  MatterSponsorName: string
  MatterSponsorSequence: number  // 1 = primary sponsor
}

export interface LegistarHistory {
  MatterHistoryId: number
  MatterHistoryMatterId: number
  MatterHistoryActionDate: string
  MatterHistoryActionName: string
  MatterHistoryPassedFlag: number | null  // 1 = passed, 0 = failed
}
