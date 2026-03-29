import mapboxgl from 'mapbox-gl';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

/**
 * Initialise a Mapbox GL map on the given container element.
 * Call this once from a useEffect hook after the container div is mounted.
 */
export function initMap(
  container: HTMLElement,
  options?: Partial<mapboxgl.MapOptions>,
): mapboxgl.Map {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  return new mapboxgl.Map({
    container,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-0.1278, 51.5074], // Default: London
    zoom: 12,
    ...options,
  });
}

/**
 * Add a listing pin marker to the map.
 */
export function addListingMarker(
  map: mapboxgl.Map,
  coords: { lng: number; lat: number },
  options?: { color?: string; popup?: string },
): mapboxgl.Marker {
  const marker = new mapboxgl.Marker({ color: options?.color ?? '#FF5A5F' })
    .setLngLat([coords.lng, coords.lat]);

  if (options?.popup) {
    const popup = new mapboxgl.Popup({ offset: 25 }).setText(options.popup);
    marker.setPopup(popup);
  }

  marker.addTo(map);
  return marker;
}

/**
 * Fit the map viewport to a bounding box that includes all provided coordinates.
 */
export function fitMapToCoords(
  map: mapboxgl.Map,
  coords: Array<{ lng: number; lat: number }>,
  padding = 60,
): void {
  if (coords.length === 0) return;

  const bounds = coords.reduce(
    (b, c) => b.extend([c.lng, c.lat]),
    new mapboxgl.LngLatBounds([coords[0].lng, coords[0].lat], [coords[0].lng, coords[0].lat]),
  );

  map.fitBounds(bounds, { padding });
}
