'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

export interface SpotListing {
  listingId: string;
  address: string;
  spotType: string;
  pricePerHour: number;
  addressLat: number;
  addressLng: number;
  covered: boolean;
  avgRating?: number;
  photos?: Array<{ validationStatus: string }>;
  hostFirstName?: string;
  hostLastName?: string;
  hostPhotoUrl?: string;
  hostId?: string;
}

export interface BBox {
  swLat: number; swLng: number; neLat: number; neLng: number;
}

interface SpotMapProps {
  spots: SpotListing[];
  onSpotSelect: (spot: SpotListing) => void;
  onSpotHover?: (spotId: string | null) => void;
  selectedSpotId?: string;
  highlightedFromCard?: string | null;
  center?: [number, number];
  defaultCenter?: { lat: number; lng: number };
  destinationCoords?: { lat: number; lng: number } | null;
  zoom?: number;
  onMoveEnd?: (bbox: BBox) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';
const NAVY = '#004526';
const AMBER = '#006B3C';

const SPOT_TYPE_LABELS: Record<string, string> = {
  COVERED_GARAGE: 'Covered garage',
  OPEN_LOT: 'Open lot',
  STREET: 'Street',
  PRIVATE_DRIVEWAY: 'Private driveway',
  OPEN_SPACE: 'Open space',
  DRIVEWAY: 'Driveway',
};

function walkingMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((km / 5) * 60);
}

function buildPopupHtml(spot: SpotListing, destCoords?: { lat: number; lng: number } | null, mapWidth?: number): string {
  const maxW = mapWidth ? Math.min(220, Math.floor(mapWidth * 0.4)) : 220;
  const photoIdx = spot.photos?.findIndex((p) => p.validationStatus === 'PASS') ?? -1;
  const photoUrl = photoIdx >= 0
    ? `${MEDIA_URL}/media/listings/${spot.listingId}/photos/${photoIdx}.jpg`
    : '';

  const typeLabel = SPOT_TYPE_LABELS[spot.spotType] ?? spot.spotType;
  const distance = destCoords
    ? `${walkingMinutes(destCoords.lat, destCoords.lng, spot.addressLat, spot.addressLng)} min walk`
    : '';

  return `
    <div style="min-width:140px;max-width:${maxW}px;font-family:system-ui,sans-serif;">
      ${photoUrl ? `<img src="${photoUrl}" alt="" style="width:100%;height:100px;object-fit:cover;border-radius:8px 8px 0 0;" />` : ''}
      <div style="padding:8px 10px;">
        <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#1C2B1A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${spot.address}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#4B6354;">${typeLabel}${distance ? ' · ' + distance : ''}</p>
        <p style="margin:0;font-size:14px;font-weight:700;color:#004526;">€${spot.pricePerHour.toFixed(2)}/hr</p>
      </div>
    </div>
  `;
}

export default function SpotMap({
  spots,
  onSpotSelect,
  onSpotHover,
  selectedSpotId,
  highlightedFromCard,
  center,
  defaultCenter,
  destinationCoords,
  zoom = 13,
  onMoveEnd,
}: SpotMapProps) {
  const initialCenter: [number, number] = center ?? (defaultCenter ? [defaultCenter.lng, defaultCenter.lat] : [4.352, 50.85]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialCenter,
      zoom,
    });

    mapRef.current = map;
    map.on('load', () => setMapReady(true));

    map.on('moveend', () => {
      if (!onMoveEnd) return;
      const bounds = map.getBounds();
      if (!bounds) return;
      onMoveEnd({
        swLat: bounds.getSouth(),
        swLng: bounds.getWest(),
        neLat: bounds.getNorth(),
        neLng: bounds.getEast(),
      });
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight pin when listing card is hovered (without full marker re-render)
  const prevCardHoverRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset previous
    if (prevCardHoverRef.current) {
      const prev = markersRef.current.get(prevCardHoverRef.current);
      if (prev) {
        const inner = prev.getElement().querySelector('.spot-pin-inner') as HTMLElement | null;
        if (inner) {
          inner.style.background = selectedSpotId === prevCardHoverRef.current ? AMBER : NAVY;
          inner.style.transform = 'scale(1)';
        }
        prev.getElement().style.zIndex = '';
      }
    }
    // Highlight current
    if (highlightedFromCard) {
      const cur = markersRef.current.get(highlightedFromCard);
      if (cur) {
        const inner = cur.getElement().querySelector('.spot-pin-inner') as HTMLElement | null;
        if (inner) {
          inner.style.background = '#AD3614';
          inner.style.transform = 'scale(1.3)';
        }
        cur.getElement().style.zIndex = '10';
      }
    }
    prevCardHoverRef.current = highlightedFromCard ?? null;
  }, [highlightedFromCard, selectedSpotId]);

  // Store latest callbacks in refs so markers don't need to re-create on callback changes
  const onSpotSelectRef = useRef(onSpotSelect);
  onSpotSelectRef.current = onSpotSelect;
  const onSpotHoverRef = useRef(onSpotHover);
  onSpotHoverRef.current = onSpotHover;
  const destCoordsRef = useRef(destinationCoords);
  destCoordsRef.current = destinationCoords;
  const spotsDataRef = useRef(spots);
  spotsDataRef.current = spots;

  // Create markers only when spots list changes
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    spots.forEach((spot) => {
      // Outer wrapper — Mapbox controls its transform for positioning, don't touch it
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'cursor: pointer;';

      // Inner visual element — safe to scale/style without breaking Mapbox positioning
      const inner = document.createElement('div');
      inner.className = 'spot-pin-inner';
      inner.dataset.listingId = spot.listingId;
      inner.style.cssText = `
        width: 32px; height: 32px; border-radius: 50%;
        background: ${NAVY};
        border: 2px solid white;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: bold; color: white;
        transition: transform 0.2s, background 0.2s;
        pointer-events: auto;
      `;
      inner.textContent = `€${spot.pricePerHour.toFixed(0)}`;
      wrapper.appendChild(inner);

      wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        onSpotSelectRef.current(spot);

        popupRef.current?.remove();

        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: false,
          offset: [0, -20],
          maxWidth: `${mapRef.current?.getContainer()?.clientWidth ? Math.min(220, Math.floor(mapRef.current.getContainer().clientWidth * 0.4)) : 220}px`,
        })
          .setLngLat([spot.addressLng, spot.addressLat])
          .setHTML(buildPopupHtml(spot, destCoordsRef.current, mapRef.current?.getContainer()?.clientWidth))
          .addTo(mapRef.current!);
        popup.on('close', () => { popupRef.current = null; });
        popupRef.current = popup;
      });

      wrapper.addEventListener('mouseenter', () => {
        inner.style.transform = 'scale(1.3)';
        wrapper.style.zIndex = '10';
        onSpotHoverRef.current?.(spot.listingId);
      });

      wrapper.addEventListener('mouseleave', () => {
        inner.style.transform = 'scale(1)';
        wrapper.style.zIndex = '';
        onSpotHoverRef.current?.(null);
        // Close popup on mouseleave
        popupRef.current?.remove();
        popupRef.current = null;
      });

      const marker = new mapboxgl.Marker({ element: wrapper })
        .setLngLat([spot.addressLng, spot.addressLat])
        .addTo(mapRef.current!);

      markersRef.current.set(spot.listingId, marker);
    });
  }, [spots, mapReady]);

  // Update marker styles when selection changes (no re-create)
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const inner = marker.getElement().querySelector('.spot-pin-inner') as HTMLElement | null;
      if (inner) {
        inner.style.background = id === selectedSpotId ? AMBER : NAVY;
      }
    });
  }, [selectedSpotId]);

  return (
    <div
      data-testid="map-container"
      ref={containerRef}
      className="h-full w-full"
    />
  );
}
