from fastapi import Header, HTTPException
from jose import JWTError, jwt
from config import settings


def _decode(token: str) -> dict | None:
    if not settings.supabase_jwt_secret:
        return None
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError:
        return None


def get_user_id(authorization: str = Header(None)) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    payload = _decode(authorization.removeprefix("Bearer "))
    return payload.get("sub") if payload else None


def require_auth(authorization: str = Header(None)) -> str:
    uid = get_user_id(authorization)
    if not uid:
        raise HTTPException(401, "Authentication required")
    return uid
