from fastapi import Header, HTTPException
import os

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")


async def require_api_key(x_api_key: str = Header(...)):
    """Validates that the request comes from the trusted Next.js server."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


async def require_admin(
    x_api_key: str = Header(...),
    x_user_role: str = Header(...),
):
    """Requires a valid API key and ADMIN role."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if x_user_role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")


async def require_admin_or_scorekeeper(
    x_api_key: str = Header(...),
    x_user_role: str = Header(...),
):
    """Requires a valid API key and ADMIN or SCOREKEEPER role."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if x_user_role not in ("ADMIN", "SCOREKEEPER"):
        raise HTTPException(status_code=403, detail="Admin or scorekeeper access required")
