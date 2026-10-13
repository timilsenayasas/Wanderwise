"""Register, log in, log out, and "who am I"."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import DbSession
from app.models import User
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
def login(body: LoginIn, response: Response, db: DbSession) -> User:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    # Always run one hash verification so wrong-email and wrong-password take the same time.
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

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
