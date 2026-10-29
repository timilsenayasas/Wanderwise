/**
 * Stand-in for @vis.gl/react-google-maps in tests: plain elements, no Google script.
 *   vi.mock('@vis.gl/react-google-maps', () => import('./mockGoogleMaps'));
 * Tests change `googleMaps` to simulate loading states and to give useMap() a fake map.
 */
import { vi } from 'vitest';

export const APILoadingStatus = {
  NOT_LOADED: 'NOT_LOADED',
  LOADING: 'LOADING',
  LOADED: 'LOADED',
  FAILED: 'FAILED',
  AUTH_FAILURE: 'AUTH_FAILURE',
};

// crash: useMap() throws, like a map that breaks while rendering.
export const googleMaps = { status: APILoadingStatus.LOADED, map: null, onError: null, crash: false };

/** A fake google.maps.Map, plus the LatLngBounds class FitToStops builds. */
export function fakeMap() {
  const map = { fitBounds: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn(), panTo: vi.fn() };
  window.google = {
    maps: {
      LatLngBounds: class {
        points = [];
        extend(point) {
          this.points.push(point);
        }
      },
    },
  };
  googleMaps.map = map;
  return map;
}

export function resetGoogleMaps() {
  googleMaps.status = APILoadingStatus.LOADED;
  googleMaps.map = null;
  googleMaps.onError = null;
  googleMaps.crash = false;
  delete window.google;
}

export function APIProvider({ apiKey, onError, children }) {
  googleMaps.onError = onError;
  return (
    <div data-testid="maps-api" data-api-key={apiKey}>
      {children}
    </div>
  );
}

export function Map({ mapId, children }) {
  return (
    <div data-testid="google-map" data-map-id={mapId}>
      {children}
    </div>
  );
}

export function AdvancedMarker({ title, onClick, children }) {
  return (
    <button type="button" data-testid="map-marker" aria-label={`Marker ${title}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function InfoWindow({ headerContent, children, onCloseClick, maxWidth }) {
  return (
    <div role="dialog" aria-label="Map details" data-max-width={maxWidth}>
      {headerContent}
      {children}
      <button type="button" onClick={onCloseClick}>
        Close details
      </button>
    </div>
  );
}

export function useMap() {
  if (googleMaps.crash) throw new Error('The map crashed');
  return googleMaps.map;
}
export const useApiLoadingStatus = () => googleMaps.status;
