# Transport API Decision

## Options Considered

For WanderWise, we considered two API options for travel and transportation data:

### Google Routes API
- Provides route calculations between locations.
- Provides travel distance and estimated travel time.
- Supports route matrices for comparing travel between multiple locations.
- Supports transportation modes that are useful when building trip itineraries.
- The Essentials tier includes a monthly free usage cap of 10,000 billable events for Compute Routes.
- Billing must be enabled on the Google Cloud project.
- Usage beyond the free monthly allowance may result in charges.

### Amadeus Self-Service API
- Provides travel-related APIs, particularly for flight, hotel, and destination information.
- Could be useful later for WanderWise features such as flight and hotel suggestions.
- It is more focused on travel search and booking data than routing users between itinerary locations.

## Decision

We selected the Google Routes API for WanderWise's transportation and routing functionality.

Google Routes is a better fit for the current project because WanderWise needs to calculate routes, distances, and estimated travel times between locations in a user's itinerary. These capabilities can help organize daily activities and determine how users can travel between itinerary stops.

Amadeus Self-Service may still be considered in the future for flight and hotel functionality, but it is not our primary choice for route calculation.

## Cost and Limits

For Google Routes API:

- Compute Routes Essentials includes a free usage cap of 10,000 billable requests per month.
- Usage above the free monthly cap is charged according to Google Maps Platform pricing.
- Billing must be enabled to use the Routes API.
- Compute Routes has a rate limit of 3,000 queries per minute.
- Basic Essentials requests can use up to 10 intermediate waypoints without moving into a higher-priced Routes tier.

For the current WanderWise development and testing workload, the free monthly usage allowance should be sufficient.

## Risk / RK1

The main risk is exceeding the free usage allowance and generating unexpected API costs. To reduce this risk, the team should monitor API usage, configure appropriate quotas or budget alerts in Google Cloud, and avoid unnecessary route requests during development.