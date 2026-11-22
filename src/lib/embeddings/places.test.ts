import { describe, expect, it } from 'vitest'
import { buildGazetteer, detectPlace, looksLikePlace, validateHaikuParse } from './places'

// A slice of the 023 seed
const gazetteer = buildGazetteer([
  { place_type: 'federal', place_id: 'us', name: 'Federal', aliases: ['federal', 'national'], covered: false },
  { place_type: 'city', place_id: 'nyc', name: 'New York City', aliases: ['nyc', 'new york city', 'new york'], covered: true },
  { place_type: 'state', place_id: 'CA', name: 'California', aliases: ['california'], covered: false },
  { place_type: 'state', place_id: 'NY', name: 'New York State', aliases: ['new york state', 'ny state'], covered: false },
  { place_type: 'state', place_id: 'WA', name: 'Washington State', aliases: ['washington state', 'washington'], covered: false },
  { place_type: 'borough', place_id: 'BX', name: 'Bronx', aliases: ['bronx', 'the bronx'], covered: true },
  { place_type: 'neighborhood', place_id: 'BK0602', name: 'Park Slope', aliases: ['park slope'], covered: true },
  { place_type: 'neighborhood', place_id: 'BK0202', name: 'Downtown Brooklyn-DUMBO-Boerum Hill', aliases: ['dumbo', 'boerum hill', 'downtown brooklyn'], covered: true },
  { place_type: 'area', place_id: 'MN:washington-heights', name: 'Washington Heights', aliases: ['washington heights'], covered: true },
])

describe('detectPlace', () => {
  it('splits a state off and drops its connector', () => {
    const parse = detectPlace('housing legislation in california', gazetteer)
    expect(parse.topicText).toBe('housing legislation')
    expect(parse.place).toMatchObject({ type: 'state', id: 'CA', covered: false })
  })

  it('finds a neighborhood at the start of the phrase', () => {
    const parse = detectPlace('park slope bike lanes', gazetteer)
    expect(parse.topicText).toBe('bike lanes')
    expect(parse.place).toMatchObject({ type: 'neighborhood', id: 'BK0602' })
  })

  it('matches colloquial aliases like DUMBO', () => {
    const parse = detectPlace('dumbo noise complaints', gazetteer)
    expect(parse.topicText).toBe('noise complaints')
    expect(parse.place?.id).toBe('BK0202')
  })

  it('leaves phrases with no place alone', () => {
    expect(detectPlace('high speed rail', gazetteer)).toEqual({ topicText: 'high speed rail', place: null })
  })

  it('prefers the longest alias', () => {
    expect(detectPlace('rent in washington heights', gazetteer).place?.id).toBe('MN:washington-heights')
    expect(detectPlace('schools in new york state', gazetteer).place?.id).toBe('NY')
    expect(detectPlace('schools in new york', gazetteer).place?.id).toBe('nyc')
  })

  it('only matches whole words', () => {
    // "bronxville" is not the Bronx
    expect(detectPlace('bronxville zoning', gazetteer).place).toBeNull()
  })

  it('handles possessives and multi-word aliases', () => {
    expect(detectPlace('nyc s budget', gazetteer)).toMatchObject({ topicText: 'budget', place: { id: 'nyc' } })
    expect(detectPlace('trash pickup in the bronx', gazetteer)).toMatchObject({ topicText: 'trash pickup', place: { id: 'BX' } })
  })

  it('keeps the whole phrase as the topic when it is only a place', () => {
    expect(detectPlace('park slope', gazetteer)).toMatchObject({ topicText: 'park slope', place: { id: 'BK0602' } })
  })
})

describe('looksLikePlace', () => {
  const topicWords = new Set(['housing', 'transportation', 'parks'])

  it('flags connector + word', () => {
    expect(looksLikePlace('bike lanes near my school', topicWords)).toBe(true)
    expect(looksLikePlace('housing in Hoboken', topicWords)).toBe(true)
  })

  it('flags a capitalized word after the first', () => {
    expect(looksLikePlace('ferry service Hoboken', topicWords)).toBe(true)
  })

  it('ignores a capitalized first word and topic words', () => {
    expect(looksLikePlace('High speed rail', topicWords)).toBe(false)
    expect(looksLikePlace('Affordable Housing', topicWords)).toBe(false)
  })
})

describe('validateHaikuParse', () => {
  it('accepts a place the gazetteer knows', () => {
    const parse = validateHaikuParse({ topic: 'Bike lanes', place: 'Park Slope' }, 'bike lanes by prospect park slope', gazetteer)
    expect(parse).toMatchObject({ topicText: 'bike lanes', place: { id: 'BK0602' } })
  })

  it('rejects places outside the gazetteer', () => {
    const phrase = 'ferry service hoboken'
    expect(validateHaikuParse({ topic: 'ferry service', place: 'Hoboken' }, phrase, gazetteer)).toEqual({
      topicText: phrase,
      place: null,
    })
  })

  it('falls back to the whole phrase when Haiku gives no topic', () => {
    expect(validateHaikuParse({ topic: null, place: 'California' }, 'california', gazetteer)).toMatchObject({
      topicText: 'california',
      place: { id: 'CA' },
    })
  })
})
