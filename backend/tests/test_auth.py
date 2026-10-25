"""Auth: register, login, logout, me, password storage."""

import hashlib
import re
from datetime import timedelta

import jwt
import pytest
from conftest import VALID_USER, register
from pydantic import ValidationError

from app import config, security
from app.config import Settings, settings
from app.database import get_db
from app.main import app
from app.models import User, utcnow
from app.security import SESSION_COOKIE, decode_access_token, session_deadline


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_register_success(client):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "ada@example.com"  # stored lowercase
    assert body["name"] == "Ada"
    assert set(body) == {"id", "email", "name"}
    assert SESSION_COOKIE in r.cookies  # registering also logs in


def test_register_duplicate_email_returns_409(client):
    register(client)
    r = register(client, email="ADA@example.com")  # case-insensitive duplicate
    assert r.status_code == 409
    assert r.json()["detail"] == "This email is already registered"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email"},
        {"password": "short"},
        {"name": "   "},
    ],
)
def test_register_validation(client, payload):
    assert register(client, **payload).status_code == 422


def test_login_sets_cookie(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": "ada@example.com", "password": VALID_USER["password"]})
    assert r.status_code == 200
    assert SESSION_COOKIE in r.cookies
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_login_wrong_password_returns_401(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"})
    assert r.status_code == 401
    assert SESSION_COOKIE not in r.cookies


def test_login_unknown_email_same_error_as_wrong_password(client):
    register(client)
    client.cookies.clear()
    wrong_pw = client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"})
    no_user = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"})
    assert no_user.status_code == wrong_pw.status_code == 401
    assert no_user.json() == wrong_pw.json()


def test_me_without_cookie_returns_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_invalid_cookie_returns_401(client):
    client.cookies.set(SESSION_COOKIE, "not-a-jwt")
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_cookie(client):
    register(client)
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "ada@example.com"


def test_logout_clears_cookie(client):
    register(client)
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    set_cookie = r.headers["set-cookie"]
    assert SESSION_COOKIE in set_cookie
    assert "Max-Age=0" in set_cookie or "expires=Thu, 01 Jan 1970" in set_cookie.lower()
    assert SESSION_COOKIE not in client.cookies
    assert client.get("/api/auth/me").status_code == 401


def test_password_hash_never_in_responses(client):
    responses = [
        register(client),
        register(client),  # 409
        client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": VALID_USER["password"]}),
        client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"}),
        client.get("/api/auth/me"),
        client.post("/api/auth/logout"),
    ]
    for r in responses:
        text = r.text
        assert "password_hash" not in text
        assert "$argon2" not in text
        assert VALID_USER["password"] not in text


def test_password_is_hashed_with_argon2id(client):
    register(client)
    db = next(app.dependency_overrides[get_db]())
    user = db.query(User).one()
    assert user.password_hash.startswith("$argon2id$")
    assert user.password_hash != VALID_USER["password"]


# --- JWT secret check at startup -----------------------------------------
STRONG_SECRET = "x" * config.MIN_JWT_SECRET_LENGTH


def make_settings(**values) -> Settings:
    # _env_file=None so a developer's own backend/.env can't change the result.
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("secret", ["change-me", "x" * (config.MIN_JWT_SECRET_LENGTH - 1)])
def test_startup_refuses_weak_secret_when_deployed(secret):
    with pytest.raises(ValidationError, match="Refusing to start"):
        make_settings(jwt_secret=secret, cookie_secure=True)


def test_weak_secret_only_warns_in_local_dev(caplog):
    settings = make_settings(jwt_secret="change-me", cookie_secure=False)
    assert settings.jwt_secret == "change-me"
    assert "JWT_SECRET" in caplog.text


def test_strong_secret_allowed_when_deployed():
    assert make_settings(jwt_secret=STRONG_SECRET, cookie_secure=True).jwt_secret == STRONG_SECRET


@pytest.mark.parametrize("cookie_secure", [False, True])
def test_leaked_secret_always_refused(monkeypatch, cookie_secure):
    # Stand-in for the real leaked value, which never appears in the code.
    leaked = "pretend-this-secret-was-committed-to-git-history"
    monkeypatch.setattr(config, "LEAKED_JWT_SECRET_SHA256", hashlib.sha256(leaked.encode()).hexdigest())
    with pytest.raises(ValidationError, match="git history"):
        make_settings(jwt_secret=leaked, cookie_secure=cookie_secure)


# --- Session renewal and the 7-day cap ------------------------------------
# PyJWT checks exp against the real clock, so these tests fake the app clock
# *backwards* (log in "in the past") instead of waiting.
SESSION = timedelta(minutes=settings.jwt_expire_minutes)
MAX_SESSION = timedelta(days=settings.session_max_days)


def whole_seconds_now():
    return utcnow().replace(microsecond=0)


def max_age(response) -> int:
    return int(re.search(r"Max-Age=(\d+)", response.headers["set-cookie"]).group(1))


def use_token_issued_at(client, monkeypatch, issued_at, user_id, auth_time):
    """Replace the session cookie with one the server issued at `issued_at`."""
    with monkeypatch.context() as m:
        m.setattr(security, "utcnow", lambda: issued_at)
        token, _ = security.create_access_token(user_id, auth_time)
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, token)
    return decode_access_token(token)


def test_login_cookie_max_age_matches_token_expiry(client):
    r = register(client)
    claims = decode_access_token(r.cookies[SESSION_COOKIE])
    assert claims.expires_at - claims.auth_time == SESSION
    assert max_age(r) == SESSION.total_seconds()


def test_fresh_session_is_not_renewed(client):
    register(client)
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert "set-cookie" not in r.headers


def test_active_session_is_renewed_after_half_its_life(client, monkeypatch):
    user_id = register(client).json()["id"]
    login = whole_seconds_now() - timedelta(minutes=31)
    before = use_token_issued_at(client, monkeypatch, login, user_id, auth_time=login)

    r = client.get("/api/auth/me")
    assert r.status_code == 200
    after = decode_access_token(r.cookies[SESSION_COOKIE])
    assert after.auth_time == before.auth_time  # renewing doesn't restart the 7-day cap
    assert after.expires_at > before.expires_at
    assert max_age(r) == SESSION.total_seconds()


def test_renewal_never_goes_past_the_cap(client, monkeypatch):
    user_id = register(client).json()["id"]
    now = whole_seconds_now()
    # Logged in almost 7 days ago; the cap is 45 minutes away.
    auth_time = now - MAX_SESSION + timedelta(minutes=45)
    use_token_issued_at(client, monkeypatch, now - timedelta(minutes=31), user_id, auth_time)

    r = client.get("/api/auth/me")
    renewed = decode_access_token(r.cookies[SESSION_COOKIE])
    assert renewed.expires_at == session_deadline(auth_time)
    assert max_age(r) <= 45 * 60

    # Already at the cap, so there's nothing to renew.
    assert "set-cookie" not in client.get("/api/auth/me").headers


def test_session_past_the_cap_is_rejected(client, monkeypatch):
    user_id = register(client).json()["id"]
    now = whole_seconds_now()
    use_token_issued_at(client, monkeypatch, now, user_id, auth_time=now - MAX_SESSION - timedelta(minutes=1))
    assert client.get("/api/auth/me").status_code == 401


def test_old_token_without_auth_time_is_rejected(client):
    user_id = register(client).json()["id"]
    old_style = jwt.encode(
        {"sub": str(user_id), "exp": utcnow() + SESSION}, settings.jwt_secret, algorithm=security.JWT_ALGORITHM
    )
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, old_style)
    assert client.get("/api/auth/me").status_code == 401


def test_other_protected_routes_renew_too(client, monkeypatch):
    user_id = register(client).json()["id"]
    login = whole_seconds_now() - timedelta(minutes=31)
    use_token_issued_at(client, monkeypatch, login, user_id, auth_time=login)
    r = client.get("/api/trips")
    assert r.status_code == 200
    assert SESSION_COOKIE in r.cookies
