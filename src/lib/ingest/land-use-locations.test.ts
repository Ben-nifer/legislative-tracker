import { describe, expect, it } from 'vitest'
import { applicationKey, blockLotBbls, cafeAddress, projectName, zapKeys } from './land-use-locations'
import { isStaleProject } from './run'

describe('Land Use titles', () => {
  it('reads the application number as ZAP writes it', () => {
    expect(applicationKey('Application number C 260193 HAX (110 East 138th Street/63 Exterior Street) submitted by')).toBe('260193HAX')
    expect(applicationKey('Application No. N 260209 HKK (DL 547, LP 2692) (Beverley Square West Historic District)')).toBe('260209HKK')
    expect(applicationKey('Application number HPD 260001 PPX (351 Powers Avenue)')).toBe('260001PPX')
    expect(applicationKey('Application number C 240123(A) ZMK (Some Rezoning)')).toBe('240123ZMK')
    expect(applicationKey('Application number M 250334A LDK (1417 Avenue U Rezoning)')).toBe('250334LDK')
    // Sidewalk cafés use a 10-digit DCWP number, not a ZAP one
    expect(applicationKey('Application number D 2650082809 SWQ (Cozy Corner)')).toBeNull()
    expect(applicationKey('Park Hill I: Block 2922, Lot 265, Staten Island')).toBeNull()
  })

  it('reads the project name, nested parentheses and all', () => {
    expect(projectName('Application number C 250268 ZMQ (63-12 Broadway Rezoning) submitted by Broadway Realty LLC')).toBe('63-12 Broadway Rezoning')
    expect(projectName('Application number C 260060 ZMM (Dewitt Clinton Park North (629 West 54th Street)) submitted by')).toBe(
      'Dewitt Clinton Park North (629 West 54th Street)'
    )
    expect(projectName('Application No. N 260209 HKK (DL 547, LP 2692) (Beverley Square West Historic District) submitted')).toBe(
      'Beverley Square West Historic District'
    )
    expect(projectName('Park Hill I: Block 2922, Lot 265, Staten Island')).toBeNull()
  })

  it('splits ZAP ulurp_numbers into keys', () => {
    expect(zapKeys('260190ZSX; N260191ZCX; 260192LDX; 260193HAX')).toEqual(['260190ZSX', '260191ZCX', '260192LDX', '260193HAX'])
    expect(zapKeys(null)).toEqual([])
  })

  it('builds BBLs from block and lot lists', () => {
    expect(blockLotBbls('160-159 Realty LLC.PLP.FY27: Block 2109, Lot 17; Block 2118, Lot 11, Manhattan, Community District 12')).toEqual([
      '1021090017',
      '1021180011',
    ])
    expect(blockLotBbls('MHANY Cluster 2.NR Rehab: Block 2265 Lots 2 and 3; Block 2282, Lot 12, Bronx, Community Districts 1')).toEqual([
      '2022650002',
      '2022650003',
      '2022820012',
    ])
    expect(blockLotBbls('Hudson View III, Block 2076, Lot 31 and 38, Manhattan, Community District No. 9')).toEqual(['1020760031', '1020760038'])
    expect(blockLotBbls('Park Hill I: Block 2922, Lot 265, Staten Island, Community District 1')).toEqual(['5029220265'])
    expect(blockLotBbls('Block 12, Lot 1 with no borough named')).toEqual([])
  })

  it('reads a sidewalk café address', () => {
    expect(
      cafeAddress('for a revocable consent to operate a sidewalk café located at 749 Ninth Avenue, New York, NY 10019, Borough of Manhattan, Community District 4')
    ).toBe('749 Ninth Avenue, 10019')
    expect(cafeAddress('located at 60-01 70th Avenue, Ridgewood, NY 11385, Borough of Queens')).toBe('60-01 70th Avenue, 11385')
    expect(cafeAddress('Application number C 260060 ZMM (Dewitt Clinton Park North)')).toBeNull()
  })
})

describe('stale projects', () => {
  const now = new Date('2026-11-22T12:00:00Z')
  it('marks projects with no activity in 12 months, and nothing else', () => {
    expect(isStaleProject({ itemType: 'project', lastActivityAt: '2025-11-01' }, now)).toBe(true)
    expect(isStaleProject({ itemType: 'project', lastActivityAt: '2026-01-15' }, now)).toBe(false)
    expect(isStaleProject({ itemType: 'bill', lastActivityAt: '2019-01-01' }, now)).toBe(false)
  })
})
