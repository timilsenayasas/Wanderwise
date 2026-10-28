/*
 * A12 Map tab: the saved plan's activities as numbered markers on a Google map.
 * VITE_GOOGLE_MAPS_KEY is a browser key (public by design, restricted to our sites in Google Cloud).
 * Advanced Markers need a Map ID: VITE_GOOGLE_MAPS_MAP_ID, or Google's DEMO_MAP_ID for development.
 * The numbered list under the map selects the same stops, so keyboard and screen reader users
 * get everything the markers show.
 * Each stay's hotel chosen on the Stay tab is its own pin ("Your hotel", a bed, not a number;
 * "Your hotel · Chitwan" when the trip has more than one), from GET /trips/{id}/lodging/pins:
 * no search, just saved coordinates. Without any, the map is unchanged.
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
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';
import EmptyState from './EmptyState';
import Icon from './Icon';
import Spinner from './Spinner';
import { formatShortDay } from '../lib/format';
import './TripMap.css';

const HOTEL_LABEL = 'Your hotel';

const isHotel = (place) => place?.kind === 'hotel';

/** "Your hotel", or with the town when there are several: "Your hotel · Chitwan". */
/** " (part 2)" for a split stay's pin, so two hotels in one town can be told apart. */
function partText(pin) {
  return pin.part ? ` (part ${pin.part})` : '';
}

function hotelPins(pins) {
  return pins.map((pin) => ({
    // Stops have numeric ids, so these can't clash with one.
    id: `hotel-${pin.stay_number}`,
    kind: 'hotel',
    city: pin.city,
    part: pin.part,
    name: pins.length > 1 ? `${HOTEL_LABEL} · ${pin.city.split(',')[0]}${partText(pin)}` : HOTEL_LABEL,
    position: { lat: pin.latitude, lng: pin.longitude },
  }));
}

/** The chosen hotels' pins, one per stay. undefined while still asking. A failed request is just no pins. */
function useHotelPins(tripId) {
  const [hotels, setHotels] = useState(tripId == null ? [] : undefined);
  useEffect(() => {
    if (tripId == null) return undefined;
    let cancelled = false;
    api
      .get(`/trips/${tripId}/lodging/pins`)
      .then((pins) => {
        if (!cancelled) setHotels(hotelPins(pins ?? []));
      })
      .catch(() => {
        if (!cancelled) setHotels([]); // the stops still show
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  return hotels;
}

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

export default function TripMap({ plan, tripId, onShowItinerary }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';
  const stops = useMemo(() => (plan ? mapStops(plan) : []), [plan]);
  const hotels = useHotelPins(tripId);
  // Everything the map fits in view: the stops plus the hotels.
  const places = useMemo(() => [...stops, ...(hotels ?? [])], [stops, hotels]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = places.find((place) => place.id === selectedId) ?? null;

  // No stops: wait for the hotel pins before saying there's nothing to show.
  if (stops.length === 0 && hotels === undefined) {
    return <Spinner size="lg" label="Loading the map" />;
  }

  if (places.length === 0) {
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
          <MapOrFallback
            stops={stops}
            hotels={hotels ?? []}
            places={places}
            selected={selected}
            onSelect={setSelectedId}
            mapId={mapId}
          />
        </APIProvider>
      ) : (
        <MapUnavailable reason="VITE_GOOGLE_MAPS_KEY isn't set in frontend/.env." />
      )}
      <StopList stops={stops} hotels={hotels ?? []} selectedId={selectedId} onSelect={setSelectedId} />
      {stops.length === 0 && (
        <div className="trip-map__no-stops">
          <p className="text-muted">Generate a plan on the Itinerary tab to add its stops to the map.</p>
          <Button variant="secondary" size="sm" onClick={onShowItinerary}>
            Go to itinerary
          </Button>
        </div>
      )}
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

function MapView({ stops, hotels, places, selected, onSelect, mapId }) {
  return (
    <div className="trip-map__map">
      <Map
        mapId={mapId}
        defaultCenter={places[0].position}
        defaultZoom={13}
        // Two fingers to move the map on phones, so the page still scrolls past it.
        gestureHandling="cooperative"
        clickableIcons={false}
        reuseMaps
      >
        <FitToStops stops={places} />
        <PanToSelected stop={selected} />
        {hotels.map((hotel) => (
          <AdvancedMarker
            key={hotel.id}
            position={hotel.position}
            title={hotel.name}
            onClick={() => onSelect(hotel.id)}
            zIndex={stops.length + 2} // above the stops, so it's never hidden under one
          >
            <span className={`trip-map__hotel-pin ${selected?.id === hotel.id ? 'trip-map__hotel-pin--selected' : ''}`}>
              <Icon name="bed" size={18} strokeWidth={2.2} />
            </span>
          </AdvancedMarker>
        ))}
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
            maxWidth={260} // fits inside the map on a 375px phone
            headerContent={<strong className="trip-map__info-title">{selected.name}</strong>}
            onCloseClick={() => onSelect(null)}
          >
            {isHotel(selected) ? (
              <p className="trip-map__info">{capitalize(whereText(selected, hotels))}, from the Stay tab.</p>
            ) : (
              <>
                <p className="trip-map__info">{stopWhen(selected)}</p>
                {selected.location && <p className="trip-map__info trip-map__info--muted">{selected.location}</p>}
              </>
            )}
          </InfoWindow>
        )}
      </Map>
    </div>
  );
}

/** "where you're staying", with the city when the trip has more than one stay's hotel. */
function whereText(hotel, hotels) {
  return hotels.length > 1 ? `where you're staying in ${hotel.city}${partText(hotel)}` : "where you're staying";
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Zoom the map to show every stop and hotel (just one: centered, street level). */
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

function StopList({ stops, hotels, selectedId, onSelect }) {
  return (
    // role="list" because Safari drops list semantics when list-style is none.
    <ol className="trip-map__stops" role="list" aria-label="Stops on the map">
      {hotels.map((hotel) => (
        <li key={hotel.id}>
          <button
            type="button"
            className="trip-map__stop"
            aria-pressed={selectedId === hotel.id}
            aria-label={`${hotel.name}, ${whereText(hotel, hotels)}`}
            onClick={() => onSelect(selectedId === hotel.id ? null : hotel.id)}
          >
            <span className="trip-map__stop-hotel" aria-hidden="true">
              <Icon name="bed" size={18} strokeWidth={2.2} />
            </span>
            <span className="trip-map__stop-text">
              <span className="trip-map__stop-name">{hotel.name}</span>
              <span className="trip-map__stop-when">{capitalize(whereText(hotel, hotels))}</span>
            </span>
          </button>
        </li>
      ))}
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
