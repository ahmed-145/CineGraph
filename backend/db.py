"""Supabase REST API client — uses HTTPS (port 443), no direct PostgreSQL needed."""
import httpx
from config import settings

_client: httpx.AsyncClient | None = None


def _headers():
    return {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _url(table: str) -> str:
    return f"{settings.supabase_url}/rest/v1/{table}"


async def init_pool():
    global _client
    if not settings.supabase_url or not settings.supabase_service_key:
        print("Supabase not configured — constellation save/load disabled")
        return
    _client = httpx.AsyncClient(timeout=10)
    # Quick connectivity check
    r = await _client.get(_url("constellations") + "?limit=1", headers=_headers())
    if r.status_code in (200, 206):
        print("Supabase REST API ready")
    else:
        print(f"Supabase REST API warning: {r.status_code} — {r.text[:120]}")


async def close_pool():
    if _client:
        await _client.aclose()


async def rest_get(table: str, params: dict) -> list:
    if not _client:
        return []
    r = await _client.get(_url(table), headers=_headers(), params=params)
    r.raise_for_status()
    return r.json()


async def rest_post(table: str, body: dict) -> dict:
    if not _client:
        raise RuntimeError("DB not configured")
    r = await _client.post(_url(table), headers=_headers(), json=body)
    r.raise_for_status()
    data = r.json()
    return data[0] if isinstance(data, list) else data


async def rest_patch(table: str, params: dict, body: dict) -> list:
    if not _client:
        raise RuntimeError("DB not configured")
    r = await _client.patch(_url(table), headers=_headers(), params=params, json=body)
    r.raise_for_status()
    return r.json()


async def rest_delete(table: str, params: dict) -> int:
    if not _client:
        raise RuntimeError("DB not configured")
    h = {**_headers(), "Prefer": "count=exact"}
    r = await _client.delete(_url(table), headers=h, params=params)
    r.raise_for_status()
    count_header = r.headers.get("content-range", "0-0/0")
    try:
        return int(count_header.split("/")[-1])
    except Exception:
        return 1


async def rest_rpc(fn: str, body: dict) -> dict:
    if not _client:
        raise RuntimeError("DB not configured")
    r = await _client.post(f"{settings.supabase_url}/rest/v1/rpc/{fn}", headers=_headers(), json=body)
    r.raise_for_status()
    return r.json()
