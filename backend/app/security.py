"""Password hashing, JWT session cookie, and the CurrentUser dependency."""

from datetime import timedelta
from typing import Annotated

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


def create_access_token(user_id: int) -> str:
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int | None:
    """Return the user id from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_access_token(user_id),
        max_age=settings.jwt_expire_minutes * 60,
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
    ww_session: Annotated[str | None, Cookie()] = None,
) -> User:
    """Dependency for protected routes: returns the logged-in User or raises 401.

    Usage in a new endpoint:
        def my_route(user: CurrentUser): ...
    """
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not ww_session:
        raise unauthorized
    user_id = decode_access_token(ww_session)
    if user_id is None:
        raise unauthorized
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
