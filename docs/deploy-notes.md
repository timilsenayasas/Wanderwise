# Deploy Notes (T3)

Things to get right when we deploy WanderWise. Most come from F3 (login security).

## Backend settings

Set these on the host, not in a committed file:

| Setting | Value | Why |
|---|---|---|
| `JWT_SECRET` | a new secret: `python -c "import secrets; print(secrets.token_urlsafe(48))"` | The server won't start with `COOKIE_SECURE=true` if it's the default or under 32 characters. It always refuses the old secret from our git history. |
| `COOKIE_SECURE` | `true` | Cookies only over HTTPS. Also turns on the strict secret check above. |
| `CORS_ORIGINS` | the deployed frontend URL | Otherwise the browser blocks API calls. |
| `JWT_EXPIRE_MINUTES` / `SESSION_MAX_DAYS` | `60` / `7` (defaults) | Sessions renew while the user is active, up to 7 days after login. |

Everyone is logged out once on the first deploy: the secret is new, and older session tokens have no `auth_time`.

## Login limit behind a proxy

The failed-login limit (5 per email + IP per 15 minutes) uses the client's IP. Hosting platforms put a proxy in front of the app, so without extra config **every user shows up with the proxy's IP**, and one person's failed logins can lock out everyone else trying that email.

uvicorn reads `X-Forwarded-For` by default, but only trusts it from `127.0.0.1`. Tell it to trust the platform's proxy, and only the proxy:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT --forwarded-allow-ips="<proxy IP or range>"
```

(or set the `FORWARDED_ALLOW_IPS` environment variable). Use `"*"` only if the platform guarantees nothing but its proxy can reach the app. Otherwise anyone can fake their IP with an `X-Forwarded-For` header and skip the limit.

## Login limit is in memory

- Counts reset when the server restarts or redeploys.
- Each worker process keeps its own counts, so with `--workers 4` someone gets up to 4 × 5 attempts. Run one worker, or move the counts to Redis.

## Cookies across domains

The session cookie is `SameSite=Lax`. That works if the frontend and API share a site (e.g. the frontend proxies `/api` to the backend, like Vite does locally). If they end up on different domains, the browser won't send the cookie on API calls. We'd then need `SameSite=None; Secure` and a CSRF check, so prefer one domain.

## Ideas, not done yet

- **Per-IP limit across all emails**, e.g. 30 attempts per 15 minutes, to slow one machine trying many accounts.
- **Limit `/api/auth/register`** per IP. Each signup runs an expensive Argon2 hash, so a flood of signups can overload the server.
- **Shared store (Redis)** for the login counts if we run more than one instance or worker.
- **Server-side logout**: logout clears the cookie, but a copied token still works until it expires, and whoever holds it can keep renewing it up to the 7-day cap. A `token_version` column on users would let us revoke sessions.
