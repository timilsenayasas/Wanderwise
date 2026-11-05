"""Register, log in, log out, and "who am I"."""

import math

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import DbSession
from app.models import User
from app.rate_limit import login_limiter
from app.schemas import LoginIn, RegisterIn, UserOut
from app.security import (
    DUMMY_HASH,
    CurrentUser,
    clear_session_cookie,
    hash_password,
    set_session_cookie,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def client_ip(request: Request) -> str:
    # Behind a hosting proxy this is the proxy's IP unless uvicorn trusts its
    # forwarded headers. See docs/deploy-notes.md.
    return request.client.host if request.client else "unknown"


def too_many_attempts(retry_after: int) -> HTTPException:
    minutes = math.ceil(retry_after / 60)
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Too many login attempts. Try again in {minutes} minute{'' if minutes == 1 else 's'}.",
        headers={"Retry-After": str(retry_after)},
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, response: Response, db: DbSession) -> User:
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")

    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two sign-ups with the same email at the same moment
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")
    db.refresh(user)

    set_session_cookie(response, user.id)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> User:
    email = body.email.lower()
    limit_key = (email, client_ip(request))
    # Checked before the email lookup and password, so a lockout blocks even the
    # right password and looks the same whether or not the account exists.
    retry_after = login_limiter.hit(limit_key)
    if retry_after:
        raise too_many_attempts(retry_after)

    user = db.scalar(select(User).where(User.email == email))
    # Always run one hash verification so wrong-email and wrong-password take the same time.
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    login_limiter.reset(limit_key)
    set_session_cookie(response, user.id)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout() -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
