# WanderWise

A travel planning web app that tells you everything you need to know about getting from point A to point B — routes, transport options, cost, and time, in one place. From planning to packing, WanderWise has you covered.

Capstone project — CSCE 4901 CAPSTONE 1, Sec 002
Instructor: David Keathly

---

## The Problem

Planning a trip means opening five tabs: one for flights, one for trains, one for maps, one for prices, one for reviews. There's no single place that answers "how do I get from here to there, and what are my options?"

WanderWise puts route options, transport modes, cost estimates, and travel time side by side so a user can compare and decide in one screen.

---

## Team

| Name | Role | GitHub |
|------|------|--------|
| Yasas Timilsena | TBD | @timilsenayasas |
| Jeremiah Shinkle | TBD | @jms1194 |
| Ashley Lira | TBD | @lash28 |
| Heeba Charaniya | TBD | @hmac1311|
| Nesna Prasai | TBD | @neshnaprasai |

**Team name:** [Wanderwise]

---

## Meetings

- **In class:** Thursdays during class hours
- **Zoom (recurring, instructor/TA meetings):** https://unt.zoom.us/j/81299504748
- **Group chat:** GroupMe — "Capstone"

---

## Project Management

- **Trello board:** [https://trello.com/invite/b/6a94b4f22c6b2c9f66069615/ATTI2e16d4ae671dbbbaaa4c865cd9563a023833FEAD/wanderwise-requirements-kanban]
- **Columns:** Backlog → Sprint To Do → In Progress → Review/Testing → Done
- Every card gets an assignee. Move your own cards as you work.

---

## Tech Stack

- **Backend:** Python 3.10+, FastAPI, SQLAlchemy + Alembic migrations (SQLite locally, Postgres optional), Argon2 password hashing, JWT in an httpOnly cookie, Gemini for AI itineraries
- **Frontend:** React 19, Vite, React Router
- **Tests:** pytest (backend), Vitest + Testing Library (frontend)

```
Wanderwise/
├── requirements.txt        Python dependencies (pinned) — the one source of truth
├── backend/
│   ├── main.py             entry point (uvicorn main:app), loads app/main.py
│   ├── app/
│   │   ├── main.py         builds the app, runs migrations on startup
│   │   ├── config.py       settings from .env
│   │   ├── database.py     engine, sessions, Base
│   │   ├── models.py       database tables
│   │   ├── schemas.py      request/response shapes (the API contract)
│   │   ├── plans.py        save/load a trip's generated plan
│   │   ├── budget.py       budget categories and a trip's cost totals
│   │   ├── lodging.py      where to stay: hotel suggestions, budget fit, the traveler's choice
│   │   ├── security.py     passwords, JWT cookie, CurrentUser
│   │   ├── rate_limit.py   limits repeated failed logins
│   │   ├── services/       outside integrations (llm.py = Gemini, geocoding.py = Google Geocoding,
│   │   │                   places.py = Google Places hotels, hotel_prices.py = Gemini price estimates)
│   │   └── routers/        endpoints, one file per feature (auth, preferences, trips, plan, budget, lodging)
│   ├── migrations/         Alembic: one file per database change
│   ├── .env.example        copy to .env
│   └── tests/              one file per feature, shared setup in conftest.py
└── frontend/
    ├── vite.config.js      dev server :5173, proxies /api → :8000
    └── src/
        ├── App.jsx         routes
        ├── api/client.js   fetch wrapper (use this for every API call)
        ├── context/        AuthContext (who is logged in)
        ├── components/     shared UI (Button, Input, Card, Navbar, Toast…)
        ├── pages/          one file per screen
        └── test/           Vitest tests
```

---

## Getting Started

You need **Python 3.10+** and **Node.js 20.19+**. Never commit `.venv/`, `node_modules/`, or `.env` — they are machine-specific (the `.gitignore` handles this). Everyone builds their own.

### 1. Backend (terminal 1)

**Windows (PowerShell)**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
copy .env.example .env            # then set JWT_SECRET (see below)
uvicorn main:app --reload
```

**macOS / Linux**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then set JWT_SECRET (see below)
uvicorn main:app --reload
```

Generate a JWT secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and paste it into `backend/.env`.

- It must be at least 32 characters. Locally a weak one only logs a warning, but with `COOKIE_SECURE=true` (deployed) the server refuses to start.
- **Made your `.env` before Sep 29?** Generate a new secret. The old shared one is public in our git history, and the server refuses it.
- Sessions last 60 minutes and renew while you're active, up to 7 days after logging in (`JWT_EXPIRE_MINUTES`, `SESSION_MAX_DAYS`).
- After 5 failed logins for the same email from the same IP, login is blocked for 15 minutes (HTTP 429). Locked yourself out while testing? Restart the backend; the counts live in memory.
- Deploying? See [docs/deploy-notes.md](docs/deploy-notes.md).

Check it works: http://localhost:8000/api/health → `{"status":"ok"}`. Interactive API docs: http://localhost:8000/docs

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
cp .env.example .env              # Windows: copy .env.example .env
npm run dev
```

Open http://localhost:5173. Requests to `/api` are forwarded to the backend, so keep both running.

### 3. Run the tests

```bash
cd backend && python -m pytest    # with the venv activated
cd frontend && npm test
```

### 4. Maps setup (optional)

The Map tab (A12) and the Stay tab's hotel suggestions need two Google keys. Without them everything else works: plans are saved without map locations, the Map tab says the map can't load, and the Stay tab still lets you add your own hotel.

In [Google Cloud Console](https://console.cloud.google.com/), use the **same project as Routes (A8)**, with billing turned on.

1. **Turn on the APIs:** APIs & Services → Library → enable **Maps JavaScript API**, **Geocoding API** and **Places API (New)**. (Not the legacy "Places API": we use the new one.)
2. **Browser key** (shows the map): APIs & Services → Credentials → Create credentials → API key, then edit it:
   - Application restrictions: **Websites** → add `http://localhost:5173/*` (and the live URL once we have one).
   - API restrictions: **Restrict key** → **Maps JavaScript API** only.
   - Put it in `frontend/.env` as `VITE_GOOGLE_MAPS_KEY=...`
3. **Server key** (turns each activity's location into coordinates when a plan is saved, and finds hotels for the Stay tab): create a second API key.
   - API restrictions: **Restrict key** → **Geocoding API** and **Places API (New)** only. (Once the backend is deployed, also restrict it to the server's IP address.)
   - Put it in `backend/.env` as `MAPS_API_KEY=...`
   - It never reaches the browser: hotel photos are fetched by the backend, which sends only the image URL.
4. **Map ID** (optional): Google Maps Platform → Map management → Create Map ID (JavaScript, Vector). Put it in `frontend/.env` as `VITE_GOOGLE_MAPS_MAP_ID=...`. If it's empty, Google's `DEMO_MAP_ID` is used, which is fine for local development.
5. **Limit the cost:** Billing → Budgets & alerts → create a small monthly budget with email alerts. Then, for each API: APIs & Services → the API → Quotas → set a requests-per-day limit, so a bug can't run up a bill.
6. **Restart** both servers. Vite reads `.env` when it starts, and `VITE_` values are built into the JavaScript, so a deployed frontend needs the key set *when it's built*.

Good to know:

- **Never commit a key.** `.env` files are git-ignored; only `.env.example` (with empty values) is committed.
- The browser key is visible to anyone who opens the site. That's normal for Google Maps, and it's why it must be restricted to our websites and the Maps JavaScript API.
- Plans saved before the server key was set have no map locations. Regenerate the plan to add them.
- Tests never call Google: `backend/tests/conftest.py` clears `MAPS_API_KEY` and fails any test that reaches Geocoding or Places, and the frontend tests mock the map and the API.

#### Where to stay (Stay tab)

A trip is split into **stays**: runs of nights in one base city. The AI plan gives every day a `base_city` (where the traveler sleeps), and consecutive nights in the same city make one stay, e.g. "Kathmandu · 2 nights" then "Chitwan · 2 nights". A trip without a plan, or with one city, has one stay and the tab looks like a single list. Stays are worked out from the plan each time and capped at 6, counting split ones (extra nights join the last one); only the choices are stored, matched to stays by number (`trip_lodging.stay_number`).

Each stay gets its own hotel suggestions from Places API (New) Text Search ("hotels in {city}", up to 6), with a nightly price estimate from Gemini (`LLM_API_KEY`) for that stay's dates, always labelled "Estimated". Choosing a hotel or adding your own puts one Lodging line per stay in the Budget tab ("Lodging · Chitwan, Nepal" on multi-city trips, changed only on the Stay tab); skipping or removing the choice takes it out. A stay's hotels are judged against what's left after the other stays' choices.

- **When a plan is regenerated:** choices stay with their stay number. If that stay is now a different city, the Stay tab and the Itinerary say "Your plan changed" instead of moving the choice. Choices for stays the new plan no longer has are listed under "No longer in your plan", and their Lodging lines stay in the budget until removed there.
- **Splitting a stay (one city, two hotels):** "Split this stay" starts a second part on the night you pick ("Kathmandu · part 1 of 2", "part 2 of 2"), each with its own choice, Lodging line ("Lodging · Kathmandu, Nepal · Oct 12 – 14"), map pin and Itinerary nights, and a "Change hotels" line on the switch day. Splits are kept in `trip_stay_splits` and survive regenerating the plan, but only apply while that night is still in the same city. The first part keeps its choice, cut to its nights; later stays' choices move along with them. "Merge with part 1" puts the parts back together: with one choice it's kept (part 2's is stretched over the whole stay), with two you choose which hotel to keep and the other goes with its Lodging line. A hotel booked for fewer nights than its stay shows "3 of 6 nights" with a one-click "Extend".
- **Nights in transit:** the plan marks nights spent on an overnight flight, train or bus (`in_transit`); they need no hotel, belong to no stay, and split a stay (the same city before and after is two stays). On the Itinerary, "I'm travelling this night" switches any night either way; that choice is kept in `trip_night_overrides` and survives regenerating the plan.
- **Itinerary and Map:** each day says where you sleep that night ("Tonight: Hotel Thamel", your own hotel's name, "in transit", or what you chose), with check-out and check-in on the days a stay ends or starts. A picked hotel's name comes from Google: the Stay tab's searches already bring the names, and the Itinerary looks up only the ones it doesn't have yet. Names are kept in memory for the page visit only (never in the database, `localStorage` or `sessionStorage`), and the Itinerary shows "Hotel names: Google Maps" attribution under them. Until a name arrives (or if the lookup fails) it says "your hotel in Chitwan". The Itinerary's estimated total is the Budget tab's, shown as plan + lodging + your other costs. The Map tab shows one "Your hotel" pin per stay with a picked hotel.
- **Cost:** asking for rating and review count puts Text Search in Google's Enterprise tier (about 1,000 free requests a month, then about $35 per 1,000), and photos are about 1,000 free a month, then $7 per 1,000 (check [Google's pricing](https://developers.google.com/maps/billing-and-pricing/pricing) for current numbers). So the app asks only for the fields it shows and loads at most 6 photos, and:

  | Action | Google calls |
  |---|---|
  | Open the Map; add your own hotel, skip, change nights or price, remove; switch a night in transit | none (just our own data) |
  | Open the Itinerary | none, if the Stay tab already loaded the picked hotels' names this visit |
  | …otherwise, once per page visit | 1 name-only Place Details per picked hotel it doesn't have yet (up to 6). `displayName` is billed in the **Place Details Pro** tier, the cheapest that includes a place's name |
  | Open the Stay tab: its first stay opens by itself | 1 Text Search + up to 6 photos, + 1 Place Details if the chosen hotel isn't in the results |
  | Open another stay's section the first time | the same, for that city |
  | Split a stay, or merge it back | none; the new part opens straight away and searches once, like any other stay |
  | Refresh a stay | the same again |
  | Choose a suggested hotel | 1 location-only Place Details (cheapest tier), for its map pin |
  | Map pin older than 30 days | 1 location-only Place Details to refresh it |

  Reopening a section doesn't search again; only Refresh does. Set a requests-per-day quota on Places API (New) as in step 5.
- **Google's rules:** only place IDs are stored, plus coordinates for at most 30 days (a pin's are refreshed when it's shown; any older than that are cleared at startup and on every pin request). Names, ratings, addresses and photos are fetched fresh and never saved. The list shows "Google Maps" attribution, and every photo credits its author and links to the place on Google Maps.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Python was not found` (Windows) | Install Python from python.org and tick **Add python.exe to PATH**. Then reopen the terminal. |
| `ModuleNotFoundError: fastapi` | Your venv isn't activated, or you skipped `pip install -r requirements.txt`. |
| `uvicorn: command not found` | Same as above — activate the venv first. |
| Frontend shows network errors | The backend isn't running on port 8000. |
| Errors mentioning `darwin` / `.so` / `rolldown` binding | You have someone else's `.venv` or `node_modules`. Delete it and reinstall. |
| Map tab says "The map can't load right now" | In development the message also gives the reason. Usually `VITE_GOOGLE_MAPS_KEY` is missing, or the key's website restrictions don't include `http://localhost:5173/*`. Restart `npm run dev` after editing `.env`. |
| Map tab says "No map locations for this plan yet" | Set `MAPS_API_KEY` in `backend/.env`, restart the backend, and regenerate the plan. The backend log says why a lookup failed. |
| Stay tab says "We can't suggest hotels right now" | `MAPS_API_KEY` is missing, or **Places API (New)** isn't enabled or allowed on the key. In development the message says whether the key is missing; otherwise the backend log names the error. |
| Hotels show "No estimate" | `LLM_API_KEY` is missing or Gemini failed. Hotels can still be chosen by entering a nightly price. |
| A multi-city trip shows only one stay | The plan was made before multi-city trips, or Gemini gave every day the same base city. Regenerate the plan. Plans without base cities are treated as one stay in the destination. |
| A stay says "Your plan changed" | A regenerated plan put a different city at that stay. Change the choice (or remove it) on the Stay tab; nothing is moved for you. |

---

## Git Workflow

`main` is protected: no direct pushes, every change goes through a pull request with one approving review.

1. Pull the latest main: `git checkout main && git pull`
2. Branch per Trello card: `git checkout -b feature/<card-name>` (or `fix/…`, `chore/…`)
3. Commit small, clear changes. Run the tests before pushing.
4. `git push -u origin feature/<card-name>` and open a pull request into `main`
5. Link the Trello card in the PR. Another teammate reviews and approves, then you merge.
6. Delete the branch after merging.

Adding a Python package: `pip install <pkg>`, then add `<pkg>==<version>` to the root `requirements.txt`. Adding an npm package: `npm install <pkg>` (commits the updated `package.json` and `package-lock.json`).

After pulling: if `requirements.txt` changed, run `pip install -r requirements.txt` (venv active). If `package.json` changed, run `npm install`.

---

## Backend: Adding Features

- **New endpoint:** add it to the matching file in `backend/app/routers/`, or create `routers/<feature>.py` and include it in `app/main.py`. Protect it with `user: CurrentUser`.
- **New request/response shape:** `app/schemas.py`.
- **Outside API (maps, weather…):** `app/services/<name>.py`. Read keys from `settings`, never hard-code them.
- **Tests:** `backend/tests/test_<feature>.py`. Use the `client` fixture and `register(client)` from `conftest.py`.

### Database changes (Alembic)

Never edit an existing migration. Each change gets a new one:

1. Change or add the table in `backend/app/models.py`.
2. From `backend/` with the venv active, generate the migration:
   ```bash
   alembic revision --autogenerate -m "add trip_days table"
   ```
3. Open the new file in `backend/migrations/versions/` and check it does what you expect.
4. Restart the backend. It applies new migrations on startup (or run `alembic upgrade head`).
5. Commit the model change **and** the migration file together.

If you forget step 2, the `test_migrations_match_models` test fails in CI and tells you.

---

