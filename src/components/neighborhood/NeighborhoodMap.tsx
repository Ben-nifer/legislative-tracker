'use client'

import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import ProposalSidePanel from './ProposalSidePanel'

// CARTO's free vector basemap — no API key or billing required.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

// MapLibre resolves its web worker relative to its own bundled module URL
// by default, which Turbopack doesn't produce a loadable asset for —
// "Worker failed to load" with a blank map. Point it at the matching
// published worker bundle instead (same npm version, so no API/behavior
// drift risk).
if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${maplibregl.getVersion()}/dist/maplibre-gl-worker.mjs`
  )
}

export type MapProposal = {
  id: string
  slug: string
  title: string
  ai_summary: string | null
  description: string | null
  status: string
  proposal_family: 'ulurp' | 'dot'
  geometry_type: 'point' | 'line' | 'polygon'
  geometry: GeoJSON.Geometry
}

// Roughly bounds all five boroughs — used when there's no single district
// to fit to (citywide view).
const NYC_BBOX: [number, number, number, number] = [-74.26, 40.49, -73.68, 40.92]

export default function NeighborhoodMap({
  proposals,
  districtGeometry,
  districtBbox,
  isLoggedIn,
}: {
  proposals: MapProposal[]
  districtGeometry?: GeoJSON.Geometry
  districtBbox?: [number, number, number, number]
  isLoggedIn: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [selected, setSelected] = useState<MapProposal | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const bbox = districtBbox ?? NYC_BBOX
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      fitBoundsOptions: { padding: 32 },
    })
    mapRef.current = map

    map.on('load', () => {
      if (districtGeometry) {
        map.addSource('district', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: districtGeometry },
        })
        map.addLayer({
          id: 'district-outline',
          type: 'line',
          source: 'district',
          paint: { 'line-color': '#003DA5', 'line-width': 2, 'line-dasharray': [2, 2] },
        })
      }

      const features: GeoJSON.Feature[] = proposals.map((p) => ({
        type: 'Feature',
        properties: {
          id: p.id,
          slug: p.slug,
          title: p.title,
          summary: p.ai_summary ?? p.description ?? null,
          status: p.status,
          proposal_family: p.proposal_family,
          geometry_type: p.geometry_type,
        },
        geometry: p.geometry,
      }))

      map.addSource('proposals', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })

      map.addLayer({
        id: 'proposals-polygons',
        type: 'fill',
        source: 'proposals',
        filter: ['==', ['get', 'geometry_type'], 'polygon'],
        paint: {
          'fill-color': ['match', ['get', 'proposal_family'], 'ulurp', '#FF6319', '#003DA5'],
          'fill-opacity': 0.25,
        },
      })
      map.addLayer({
        id: 'proposals-polygons-outline',
        type: 'line',
        source: 'proposals',
        filter: ['==', ['get', 'geometry_type'], 'polygon'],
        paint: {
          'line-color': ['match', ['get', 'proposal_family'], 'ulurp', '#FF6319', '#003DA5'],
          'line-width': 2,
        },
      })
      map.addLayer({
        id: 'proposals-lines',
        type: 'line',
        source: 'proposals',
        filter: ['==', ['get', 'geometry_type'], 'line'],
        paint: {
          'line-color': ['match', ['get', 'proposal_family'], 'ulurp', '#FF6319', '#003DA5'],
          'line-width': 4,
        },
      })
      map.addLayer({
        id: 'proposals-points',
        type: 'circle',
        source: 'proposals',
        filter: ['==', ['get', 'geometry_type'], 'point'],
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'proposal_family'], 'ulurp', '#FF6319', '#003DA5'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#FFFFFF',
        },
      })

      const clickableLayers = ['proposals-points', 'proposals-lines', 'proposals-polygons']
      for (const layerId of clickableLayers) {
        map.on('click', layerId, (e: maplibregl.MapLayerMouseEvent) => {
          const feature = e.features?.[0]
          if (!feature) return
          const match = proposals.find((p) => p.id === feature.properties?.id)
          if (match) setSelected(match)
        })
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // districtGeometry/proposals intentionally captured once on mount —
    // this page is a per-district server render, not a live-updating view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {selected && (
        <ProposalSidePanel
          proposal={{
            id: selected.id,
            slug: selected.slug,
            title: selected.title,
            summary: selected.ai_summary ?? selected.description,
            status: selected.status,
            proposal_family: selected.proposal_family,
            geometry_type: selected.geometry_type,
          }}
          isLoggedIn={isLoggedIn}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
