import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from auth import require_auth, get_user_id

router = APIRouter()


class SaveRequest(BaseModel):
    name: str = "Untitled Constellation"
    data: dict
    constellation_id: str | None = None


# ── constellation CRUD ─────────────────────────────────────────────────────────

@router.get("/constellations")
async def list_constellations(user_id: str = Depends(require_auth)):
    rows = await db.rest_get("constellations", {
        "user_id": f"eq.{user_id}",
        "select": "id,name,updated_at",
        "order": "updated_at.desc",
        "limit": "20",
    })
    return rows


@router.post("/constellations")
async def save_constellation(req: SaveRequest, user_id: str = Depends(require_auth)):
    if req.constellation_id:
        rows = await db.rest_patch(
            "constellations",
            {"id": f"eq.{req.constellation_id}", "user_id": f"eq.{user_id}"},
            {"name": req.name, "data": req.data, "updated_at": "now()"},
        )
        if not rows:
            raise HTTPException(404, "Constellation not found")
        return {"id": req.constellation_id, "name": req.name}
    else:
        row = await db.rest_post("constellations", {
            "user_id": user_id,
            "name": req.name,
            "data": req.data,
        })
        return {"id": row["id"], "name": row["name"]}


@router.get("/constellations/{cid}")
async def load_constellation(cid: str, user_id: str = Depends(require_auth)):
    rows = await db.rest_get("constellations", {
        "id": f"eq.{cid}",
        "user_id": f"eq.{user_id}",
        "select": "id,name,data",
        "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Constellation not found")
    return rows[0]


@router.delete("/constellations/{cid}")
async def delete_constellation(cid: str, user_id: str = Depends(require_auth)):
    count = await db.rest_delete("constellations", {
        "id": f"eq.{cid}",
        "user_id": f"eq.{user_id}",
    })
    if count == 0:
        raise HTTPException(404, "Constellation not found")
    return {"ok": True}


# ── share / snapshot ───────────────────────────────────────────────────────────

@router.post("/constellations/{cid}/share")
async def share_constellation(cid: str, user_id: str = Depends(require_auth)):
    rows = await db.rest_get("constellations", {
        "id": f"eq.{cid}",
        "user_id": f"eq.{user_id}",
        "select": "id,name,data",
        "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Constellation not found")
    # Re-use existing snapshot if already shared
    existing = await db.rest_get("snapshots", {
        "constellation_id": f"eq.{cid}",
        "select": "slug",
        "limit": "1",
    })
    if existing:
        return {"slug": existing[0]["slug"]}
    slug = secrets.token_urlsafe(6)
    await db.rest_post("snapshots", {
        "slug": slug,
        "constellation_id": cid,
        "creator_id": user_id,
        "name": rows[0]["name"],
        "data": rows[0]["data"],
    })
    return {"slug": slug}


@router.post("/constellations/{slug}/fork")
async def fork_constellation(slug: str, user_id: str = Depends(require_auth)):
    snaps = await db.rest_get("snapshots", {
        "slug": f"eq.{slug}",
        "select": "name,data",
        "limit": "1",
    })
    if not snaps:
        raise HTTPException(404, "Snapshot not found")
    snap = snaps[0]
    row = await db.rest_post("constellations", {
        "user_id": user_id,
        "name": f"{snap['name']} (fork)",
        "data": snap["data"],
    })
    return {"id": row["id"], "name": row["name"]}


# ── public snapshot read ───────────────────────────────────────────────────────

@router.get("/c/{slug}")
async def get_snapshot(slug: str, user_id: str = Depends(get_user_id)):
    rows = await db.rest_get("snapshots", {
        "slug": f"eq.{slug}",
        "select": "name,data,view_count,created_at",
        "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Snapshot not found")
    snap = rows[0]
    # Increment view count (fire and forget)
    try:
        await db.rest_patch("snapshots", {"slug": f"eq.{slug}"}, {
            "view_count": snap["view_count"] + 1
        })
    except Exception:
        pass
    return {
        "name": snap["name"],
        "data": snap["data"],
        "view_count": snap["view_count"],
        "created_at": snap["created_at"],
        "slug": slug,
    }
