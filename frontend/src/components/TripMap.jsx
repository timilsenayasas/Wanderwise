/*
 * A12 Map tab: the saved plan's activities as numbered markers on a Google map.
 * VITE_GOOGLE_MAPS_KEY is a browser key (public by design, restricted to our sites in Google Cloud).
 * Advanced Markers need a Map ID: VITE_GOOGLE_MAPS_MAP_ID, or Google's DEMO_MAP_ID for development.
 * The numbered list under the map selects the same stops, so keyboard and screen reader users
 * get everything the markers show.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import Button from './Button';
import Card from './Card';
import EmptyState from './EmptyState';
import Icon from './Icon';
import { formatShortDay } from '../lib/format';
import './TripMap.css';

/** Activities that have coordinates, numbered in visit order. */
export function mapStops(plan) {
  const stops = [];
  for (const day of plan.days) {
    for (const activity of day.activities) {
      if (activity.latitude == null || activity.longitude == null) continue;
      stops.push({
        id: activity.id,
        number: stops.length + 1,
        name: activity.name,
        location: activity.location,
        dayNumber: day.day_number,
        date: day.date,
        startTime: activity.start_time,
        endTime: activity.end_time,
        position: { lat: activity.latitude, lng: activity.longitude },
      });
    }
  }
  return stops;
}

function stopWhen(stop) {
  return `Day ${stop.dayNumber} · ${formatShortDay(stop.date)} · ${stop.startTime}–${stop.endTime}`;
}

export default function TripMap({ plan, onShowItinerary }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';
  const stops = useMemo(() => (plan ? mapStops(plan) : []), [plan]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = stops.find((stop) => stop.id === selectedId) ?? null;

  if (stops.length === 0) {
    return (
      <section className="trip-map" aria-labelledby="map-title">
        <h2 id="map-title">Map</h2>
        <Card padding="lg">
          <EmptyState
            headingLevel={3}
            title={plan ? 'No map locations for this plan yet' : 'No plan yet'}
            description={
              plan
                ? 'Regenerate the plan on the Itinerary tab to add its stops to the map.'
                : 'Generate a plan on the Itinerary tab to see its stops on a map.'
            }
            action={<Button onClick={onShowItinerary}>Go to itinerary</Button>}
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="trip-map" aria-labelledby="map-title">
      <h2 id="map-title">Map</h2>
      {/* No key: say so instead of loading a map that can only show an error. */}
      {apiKey ? (
        <APIProvider apiKey={apiKey}>
          <MapOrFallback stops={stops} selected={selected} onSelect={setSelectedId} mapId={mapId} />
        </APIProvider>
      ) : (
        <MapUnavailable reason="VITE_GOOGLE_MAPS_KEY isn't set in frontend/.env." />
      )}
      <StopList stops={stops} selectedId={selectedId} onSelect={setSelectedId} />
    </section>
  );
}

/** The map, or a message if the Google script failed to load or rejected the key. */
function MapOrFallback(props) {
  const status = useApiLoadingStatus();
  if (status === APILoadingStatus.FAILED) {
    return <MapUnavailable reason="The Google Maps script failed to load." />;
  }
  if (status === APILoadingStatus.AUTH_FAILURE) {
    return <MapUnavailable reason="Google rejected the browser key (check its website and API restrictions)." />;
  }
  return <MapView {...props} />;
}

/** The stop list below still works, so the tab stays useful without the map. */
export function MapUnavailable({ reason }) {
  return (
    <div className="trip-map__unavailable" role="status">
      <Icon name="map" />
      <p>
        The map can&apos;t load right now. Your stops are listed below.
        {/* Only in development, for whoever is setting up the keys. */}
        {import.meta.env.DEV && reason && <span className="trip-map__dev-hint"> {reason}</span>}
      </p>
    </div>
  );
}

function MapView({ stops, selected, onSelect, mapId }) {
  return (
    <div className="trip-map__map">
      <Map
        mapId={mapId}
        defaultCenter={stops[0].position}
        defaultZoom={13}
        // Two fingers to move the map on phones, so the page still scrolls past it.
        gestureHandling="cooperative"
        clickableIcons={false}
        reuseMaps
      >
        <FitToStops stops={stops} />
        <PanToSelected stop={selected} />
        {stops.map((stop) => (
          <AdvancedMarker
            key={stop.id}
            position={stop.position}
            title={`${stop.number}. ${stop.name}`}
            onClick={() => onSelect(stop.id)}
            zIndex={stop.id === selected?.id ? stops.length + 1 : stop.number}
          >
            <span className={`trip-map__pin ${stop.id === selected?.id ? 'trip-map__pin--selected' : ''}`}>
              {stop.number}
            </span>
          </AdvancedMarker>
        ))}
        {selected && (
          <InfoWindow
            position={selected.position}
            pixelOffset={[0, -40]} // above the pin, not on it
            headerContent={<strong className="trip-map__info-title">{selected.name}</strong>}
            onCloseClick={() => onSelect(null)}
          >
            <p className="trip-map__info">{stopWhen(selected)}</p>
            {selected.location && <p className="trip-map__info trip-map__info--muted">{selected.location}</p>}
          </InfoWindow>
        )}
      </Map>
    </div>
  );
}

/** Zoom the map to show every stop (one stop: centered, street level). */
function FitToStops({ stops }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (stops.length === 1) {
      map.setCenter(stops[0].position);
      map.setZoom(15);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    stops.forEach((stop) => bounds.extend(stop.position));
    map.fitBounds(bounds, 48);
  }, [map, stops]);
  return null;
}

/** Bring a stop picked from the list into view. */
function PanToSelected({ stop }) {
  const map = useMap();
  useEffect(() => {
    if (map && stop) map.panTo(stop.position);
  }, [map, stop]);
  return null;
}

function StopList({ stops, selectedId, onSelect }) {
  return (
    // role="list" because Safari drops list semantics when list-style is none.
    <ol className="trip-map__stops" role="list" aria-label="Stops on the map">
      {stops.map((stop) => (
        <li key={stop.id}>
          <button
            type="button"
            className="trip-map__stop"
            aria-pressed={stop.id === selectedId}
            // Spelled out: the spans below would otherwise run together ("Stop 1:Jazz clubDay 1").
            aria-label={`Stop ${stop.number}: ${stop.name}, ${stopWhen(stop)}`}
            onClick={() => onSelect(stop.id === selectedId ? null : stop.id)}
          >
            <span className="trip-map__stop-number" aria-hidden="true">
              {stop.number}
            </span>
            <span className="trip-map__stop-text">
              <span className="trip-map__stop-name">{stop.name}</span>
              <span className="trip-map__stop-when">{stopWhen(stop)}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
