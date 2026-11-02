// Shared geometry helpers for proposal/district ingestion. Plain TypeScript,
// no PostGIS — this app stores geometry as GeoJSON jsonb and precomputes
// membership/bbox once at ingestion time (see V2 neighborhood-map plan).

export type Ring = [number, number][]
export type Polygon = Ring[] // [outerRing, ...holes]
export type MultiPolygon = Polygon[]
export type LineString = [number, number][]
export type MultiLineString = LineString[]

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'Polygon'; coordinates: Polygon }
  | { type: 'MultiPolygon'; coordinates: MultiPolygon }
  | { type: 'LineString'; coordinates: LineString }
  | { type: 'MultiLineString'; coordinates: MultiLineString }

// Ray-casting point-in-polygon (extracted from the original
// src/lib/council/sync-community-boards.ts implementation).
export function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function pointInPolygon(px: number, py: number, polygon: Polygon): boolean {
  return pointInRing(px, py, polygon[0]!)
}

export function pointInMultiPolygon(px: number, py: number, mp: MultiPolygon): boolean {
  return mp.some((polygon) => pointInPolygon(px, py, polygon))
}

// Accepts a raw Polygon or MultiPolygon geometry object.
export function pointInGeometry(
  px: number,
  py: number,
  geometry: { type: string; coordinates: unknown }
): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(px, py, geometry.coordinates as Polygon)
  }
  if (geometry.type === 'MultiPolygon') {
    return pointInMultiPolygon(px, py, geometry.coordinates as MultiPolygon)
  }
  return false
}

// Average of all outer-ring vertices (good enough for centroid approximation).
export function centroidOfMultiPolygon(mp: MultiPolygon): [number, number] {
  const outerRings = mp.map((p) => p[0]!)
  const ring = outerRings.reduce((best, r) => (r.length > best.length ? r : best), outerRings[0]!)
  const x = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const y = ring.reduce((s, p) => s + p[1], 0) / ring.length
  return [x, y]
}

export function centroidOfPolygon(polygon: Polygon): [number, number] {
  return centroidOfMultiPolygon([polygon])
}

// Bounding box of any coordinate pairs nested arbitrarily deep.
export function bboxOfCoordinates(coords: unknown): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  function walk(node: unknown) {
    if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = node as [number, number]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
    }
  }

  walk(coords)
  return [minX, minY, maxX, maxY]
}

export function bboxOfGeometry(geometry: { coordinates: unknown }): [number, number, number, number] {
  return bboxOfCoordinates(geometry.coordinates)
}

export function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}
