/*
 * S4 Itinerary, with "Day by day" and "Budget" tabs.
 * TODO(owner): F5 day-by-day itinerary, F6 activities, F7 transport, F8 budget,
 * F9 weather, F10 packing tips, F11 map, F4 AI chat. The trip id is in the URL.
 */
import { useParams } from 'react-router-dom';
import UnderConstruction from './UnderConstruction';

export default function Itinerary() {
  const { tripId } = useParams();
  return (
    <UnderConstruction
      screen="S4 · Itinerary"
      title="Your itinerary"
      description={`Day-by-day plan and budget for trip ${tripId}.`}
      features="F5 day-by-day itinerary, F8 budget & cost breakdown (Day by day | Budget tabs), F4 AI chat, F9 weather, F11 map"
    />
  );
}
