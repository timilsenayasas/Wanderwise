"""Auth: register, login, logout, me, password storage."""

import pytest
from conftest import VALID_USER, register

from app.database import get_db
from app.main import app
from app.models import User
from app.security import SESSION_COOKIE


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
