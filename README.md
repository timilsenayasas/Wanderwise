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
| Jeremiah S. | TBD | @jms1194 |
| Ashley | TBD | @lash28 |
| Heeba | TBD | @hmac1311|
| Nesna | TBD | @neshnaprasai |

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

- **Backend:** Python 3.10+, FastAPI, SQLAlchemy (SQLite locally, Postgres optional), Argon2 password hashing, JWT in an httpOnly cookie
- **Frontend:** React 19, Vite, React Router
- **Tests:** pytest (backend), Vitest + Testing Library (frontend)

```
Wanderwise/
├── requirements.txt        Python dependencies (pinned) — the one source of truth
├── backend/
│   ├── main.py             whole API: Config → Database → Models → Schemas → Security → Endpoints
│   ├── .env.example        copy to .env
│   └── tests/test_main.py
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

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Python was not found` (Windows) | Install Python from python.org and tick **Add python.exe to PATH**. Then reopen the terminal. |
| `ModuleNotFoundError: fastapi` | Your venv isn't activated, or you skipped `pip install -r requirements.txt`. |
| `uvicorn: command not found` | Same as above — activate the venv first. |
| Frontend shows network errors | The backend isn't running on port 8000. |
| Errors mentioning `darwin` / `.so` / `rolldown` binding | You have someone else's `.venv` or `node_modules`. Delete it and reinstall. |

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

---

