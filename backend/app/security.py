"""Password hashing, JWT session cookie, and the CurrentUser dependency.

Sessions last JWT_EXPIRE_MINUTES and are renewed while the user is active, but
never run past SESSION_MAX_DAYS after the user last typed their password.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated, NamedTuple

import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import settings
from app.database import DbSession
from app.models import User, utcnow

SESSION_COOKIE = "ww_session"
JWT_ALGORITHM = "HS256"

# Argon2id with pwdlib's recommended parameters.
password_hasher = PasswordHash((Argon2Hasher(),))

# Used when a login email doesn't exist, so the response takes the same time
# as a real password check and doesn't reveal which accounts exist.
DUMMY_HASH = password_hasher.hash("wanderwise-dummy-password")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password, password_hash)
    except Exception:  # malformed hash etc. -> treat as mismatch
        return False


class SessionClaims(NamedTuple):
    user_id: int
    auth_time: datetime  # when the user logged in; renewals keep it
    expires_at: datetime


def _now() -> datetime:
    # JWT times are whole seconds, so drop microseconds to keep exp and max_age equal.
    return utcnow().replace(microsecond=0)


def _from_timestamp(value: int) -> datetime:
    return datetime.fromtimestamp(value, tz=timezone.utc)


def session_deadline(auth_time: datetime) -> datetime:
    """The latest a session can last, however active the user is."""
    return auth_time + timedelta(days=settings.session_max_days)


def create_access_token(user_id: int, auth_time: datetime) -> tuple[str, int]:
    """Return a signed token and its lifetime in seconds (used as the cookie max_age)."""
    now = _now()
    expires_at = min(now + timedelta(minutes=settings.jwt_expire_minutes), session_deadline(auth_time))
    payload = {
        "sub": str(user_id),
        "iat": now,
        "auth_time": int(auth_time.timestamp()),
        "exp": expires_at,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)
    return token, int((expires_at - now).total_seconds())


def decode_access_token(token: str) -> SessionClaims | None:
    """Return the claims from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            # Tokens from before session renewal have no auth_time; those users log in again.
            options={"require": ["exp", "sub", "auth_time"]},
        )
        return SessionClaims(
            user_id=int(payload["sub"]),
            auth_time=_from_timestamp(payload["auth_time"]),
            expires_at=_from_timestamp(payload["exp"]),
        )
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        return None


def should_renew(claims: SessionClaims) -> bool:
    """Renew once less than half the session is left, unless the cap means it can't get longer."""
    half_session = timedelta(minutes=settings.jwt_expire_minutes) / 2
    return claims.expires_at - _now() < half_session and claims.expires_at < session_deadline(claims.auth_time)


def set_session_cookie(response: Response, user_id: int, auth_time: datetime | None = None) -> None:
    """Start a new session (no auth_time) or renew one (pass the original auth_time)."""
    token, lifetime_seconds = create_access_token(user_id, auth_time or _now())
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=lifetime_seconds,
        httponly=True,  # JS can't read it (protects against XSS token theft)
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def get_current_user(
    db: DbSession,
    response: Response,
    ww_session: Annotated[str | None, Cookie()] = None,
) -> User:
    """Dependency for protected routes: returns the logged-in User or raises 401.
    Also renews the session cookie while the user is active.

    Usage in a new endpoint:
        def my_route(user: CurrentUser): ...
    """
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not ww_session:
        raise unauthorized
    claims = decode_access_token(ww_session)
    if claims is None:
        raise unauthorized
    user = db.get(User, claims.user_id)
    if user is None:
        raise unauthorized
    if should_renew(claims):
        set_session_cookie(response, user.id, claims.auth_time)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
