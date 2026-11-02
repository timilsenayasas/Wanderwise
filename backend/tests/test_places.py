"""Where to stay: hotel search with Google Places API (New). Google is faked; no real calls are made."""

import logging

import httpx

from app.config import settings
from app.services import places

# Saved before the autouse no_real_places fixture swaps it out.
REAL_FETCH = places._fetch


def place(place_id: str, name: str, **overrides) -> dict:
    """A Text Search result with everything the hotel cards use."""
    return {
        "id": place_id,
        "displayName": {"text": name, "languageCode": "en"},
        "formattedAddress": f"1 {name} St, Chicago, IL 60611, USA",
        "addressComponents": [
            {"longText": "Near North Side", "shortText": "Near North Side", "types": ["neighborhood", "political"]},
            {"longText": "Chicago", "shortText": "Chicago", "types": ["locality", "political"]},
        ],
        "location": {"latitude": 41.89, "longitude": -87.62},
        "rating": 4.6,
        "userRatingCount": 1284,
        "googleMapsUri": f"https://maps.google.com/?cid={place_id}",
        "photos": [
            {
                "name": f"places/{place_id}/photos/photo-{place_id}",
                "authorAttributions": [
                    {"displayName": "Sam Lee", "uri": "https://maps.google.com/maps/contrib/1", "photoUri": "//lh3/a"}
                ],
            }
        ],
        **overrides,
    }


def photo_uri(place_id: str) -> str:
    return f"https://lh3.googleusercontent.com/{place_id}"


def fake_places(monkeypatch, search=None, details=None, photos=None) -> list[dict]:
    """Places answers from the given bodies (or exceptions); every photo resolves unless `photos` says otherwise.

    Returns the requests Google was sent.
    """
    monkeypatch.setattr(settings, "maps_api_key", "test-key")
    sent = []

    def fake_fetch(method, url, field_mask=None, body=None, params=None):
        sent.append({"method": method, "url": url, "field_mask": field_mask, "body": body, "params": params})
        if url == places.SEARCH_URL:
            answer = search
        elif url.endswith("/media"):
            name = url.removeprefix("https://places.googleapis.com/v1/").removesuffix("/media")
            place_id = name.split("/")[1]
            answer = (photos or {}).get(place_id, {"name": name, "photoUri": photo_uri(place_id)})
        else:
            answer = (details or {})[url.rsplit("/", 1)[1]]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(places, "_fetch", fake_fetch)
    return sent


def searches(sent: list[dict]) -> list[dict]:
    return [request for request in sent if request["url"] == places.SEARCH_URL]


def photo_requests(sent: list[dict]) -> list[dict]:
    return [request for request in sent if request["url"].endswith("/media")]


# --- Requests -------------------------------------------------------------
def test_the_key_goes_in_a_header_never_the_url(monkeypatch):
    monkeypatch.setattr(settings, "maps_api_key", "test-key")
    sent = {}

    def fake_request(method, url, **kwargs):
        sent.update(method=method, url=url, **kwargs)
        return httpx.Response(200, json={"places": []}, request=httpx.Request(method, url))

    monkeypatch.setattr(places.httpx, "request", fake_request)

    REAL_FETCH("POST", places.SEARCH_URL, field_mask="places.id", body={"textQuery": "hotels in Chicago"})

    assert sent["headers"] == {"X-Goog-Api-Key": "test-key", "X-Goog-FieldMask": "places.id"}
    assert "test-key" not in sent["url"]
    assert sent["params"] is None
    assert sent["timeout"] == places.TIMEOUT_SECONDS


# --- Search ---------------------------------------------------------------
def test_search_asks_for_hotels_with_only_the_fields_we_show(monkeypatch):
    sent = fake_places(monkeypatch, search={"places": [place("p1", "The Drake")]})

    places.search_hotels("Chicago, IL")

    [search] = searches(sent)
    assert search["method"] == "POST"
    assert search["body"] == {
        "textQuery": "hotels in Chicago, IL",
        "includedType": "lodging",
        "strictTypeFiltering": True,
        "pageSize": 6,
    }
    assert search["field_mask"].split(",") == [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.addressComponents",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.photos",
        "places.googleMapsUri",
    ]


def test_search_returns_hotels_with_a_fresh_photo_url_and_author_credit(monkeypatch):
    sent = fake_places(monkeypatch, search={"places": [place("p1", "The Drake"), place("p2", "Hotel Lux")]})

    result = places.search_hotels("Chicago, IL")

    assert result.status == "ok"
    assert [hotel.name for hotel in result.hotels] == ["The Drake", "Hotel Lux"]
    drake = result.hotels[0]
    assert drake.place_id == "p1"
    assert drake.area == "Near North Side"
    assert drake.location == (41.89, -87.62)
    assert (drake.rating, drake.review_count) == (4.6, 1284)
    assert drake.google_maps_uri == "https://maps.google.com/?cid=p1"
    assert drake.photo.uri == photo_uri("p1")
    assert drake.photo.authors == (places.PhotoAuthor(name="Sam Lee", uri="https://maps.google.com/maps/contrib/1"),)

    # The image URL comes from the media endpoint as JSON; the browser never needs our key.
    first = photo_requests(sent)[0]
    assert first["url"] == "https://places.googleapis.com/v1/places/p1/photos/photo-p1/media"
    assert first["params"] == {"maxWidthPx": 800, "skipHttpRedirect": "true"}


def test_search_keeps_at_most_six_hotels_and_six_photos(monkeypatch):
    many = [place(f"p{n}", f"Hotel {n}") for n in range(8)]
    sent = fake_places(monkeypatch, search={"places": many})

    result = places.search_hotels("Chicago, IL")

    assert len(result.hotels) == 6
    assert len(photo_requests(sent)) == 6


def test_area_falls_back_to_the_town_then_the_full_address(monkeypatch):
    town_only = place("p1", "Town Inn", addressComponents=[{"longText": "Evanston", "types": ["locality"]}])
    no_parts = place("p2", "Plain Inn", addressComponents=None)
    fake_places(monkeypatch, search={"places": [town_only, no_parts]})

    result = places.search_hotels("Chicago, IL")

    assert [hotel.area for hotel in result.hotels] == ["Evanston", "1 Plain Inn St, Chicago, IL 60611, USA"]


def test_missing_rating_location_or_photo_still_gives_a_hotel(monkeypatch):
    bare = {"id": "p1", "displayName": {"text": "New Inn"}}
    sent = fake_places(monkeypatch, search={"places": [bare]})

    [hotel] = places.search_hotels("Chicago, IL").hotels

    assert (hotel.name, hotel.rating, hotel.review_count, hotel.location, hotel.photo) == (
        "New Inn",
        None,
        None,
        None,
        None,
    )
    assert photo_requests(sent) == []


def test_results_without_an_id_or_name_are_skipped(monkeypatch):
    results = [
        place("", "No Id"),
        place("p2", "Bad Id", id="../../etc"),
        {"id": "p3", "displayName": {}},
        place("p4", "Good Hotel"),
    ]
    fake_places(monkeypatch, search={"places": results})

    assert [hotel.name for hotel in places.search_hotels("Chicago, IL").hotels] == ["Good Hotel"]


def test_a_failed_photo_leaves_the_hotel_without_one(monkeypatch):
    fake_places(
        monkeypatch,
        search={"places": [place("p1", "The Drake"), place("p2", "Hotel Lux")]},
        photos={"p1": httpx.ConnectError("down"), "p2": {"photoUri": "http://not-https.example/x"}},
    )

    result = places.search_hotels("Chicago, IL")

    assert [hotel.name for hotel in result.hotels] == ["The Drake", "Hotel Lux"]
    assert [hotel.photo for hotel in result.hotels] == [None, None]


def test_an_odd_photo_name_is_never_requested(monkeypatch):
    odd = place("p1", "The Drake", photos=[{"name": "https://evil.example/x", "authorAttributions": []}])
    sent = fake_places(monkeypatch, search={"places": [odd]})

    [hotel] = places.search_hotels("Chicago, IL").hotels

    assert hotel.photo is None
    assert photo_requests(sent) == []


def test_no_matches_is_ok_and_empty(monkeypatch):
    fake_places(monkeypatch, search={})  # Google leaves "places" out when nothing matches

    assert places.search_hotels("Nowhere") == places.HotelSearch(status="ok", hotels=[])


def test_without_a_key_nothing_is_looked_up(monkeypatch, caplog):
    monkeypatch.setattr(settings, "maps_api_key", "")
    # The autouse no_real_places fixture fails the test if Google is called.

    with caplog.at_level(logging.WARNING, logger="wanderwise"):
        result = places.search_hotels("Chicago, IL")

    assert result == places.HotelSearch(status="not_configured", hotels=[])
    assert "MAPS_API_KEY isn't set" in caplog.text


def test_a_failed_search_is_unavailable_and_logs_no_key(monkeypatch, caplog):
    fake_places(monkeypatch, search=httpx.ConnectError("https://places.googleapis.com/?key=test-key"))

    with caplog.at_level(logging.WARNING, logger="wanderwise"):
        result = places.search_hotels("Chicago, IL")

    assert result == places.HotelSearch(status="unavailable", hotels=[])
    assert "ConnectError" in caplog.text
    assert "test-key" not in caplog.text


def test_an_unexpected_search_answer_is_unavailable(monkeypatch):
    fake_places(monkeypatch, search=["not", "an", "object"])

    assert places.search_hotels("Chicago, IL").status == "unavailable"


# --- One hotel --------------------------------------------------------------
def test_get_hotel_reads_details_and_a_fresh_photo(monkeypatch):
    sent = fake_places(monkeypatch, details={"p1": place("p1", "The Drake")})

    hotel = places.get_hotel("p1")

    assert hotel.name == "The Drake"
    assert hotel.photo.uri == photo_uri("p1")
    details = sent[0]
    assert (details["method"], details["url"]) == ("GET", "https://places.googleapis.com/v1/places/p1")
    assert details["field_mask"] == places.DETAILS_FIELD_MASK
    assert "places." not in details["field_mask"]


def test_get_hotel_failure_or_bad_id_gives_none(monkeypatch):
    sent = fake_places(monkeypatch, details={"p1": httpx.ReadTimeout("slow")})

    assert places.get_hotel("p1") is None
    assert places.get_hotel("../p1") is None
    assert len(sent) == 1  # the bad id was never sent


def test_get_location_asks_only_for_the_location(monkeypatch):
    sent = fake_places(monkeypatch, details={"p1": {"location": {"latitude": 41.9, "longitude": -87.6}}})

    assert places.get_location("p1") == (41.9, -87.6)
    assert sent[0]["field_mask"] == "location"


def test_get_location_failure_or_no_key_gives_none(monkeypatch):
    fake_places(monkeypatch, details={"p1": httpx.ConnectError("down"), "p2": {}})

    assert places.get_location("p1") is None
    assert places.get_location("p2") is None

    monkeypatch.setattr(settings, "maps_api_key", "")
    assert places.get_hotel("p1") is None
    assert places.get_location("p1") is None
