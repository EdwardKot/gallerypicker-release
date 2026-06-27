import os
import asyncio
import mimetypes
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import json
from app.database import get_db
from app.events import announcer
from app.scanner import scan_photos
from app.thumbnails import generate_thumbnail, get_cache_stats, clear_cache
from app.config import DEFAULT_PAGE_SIZE
from app.photo_service import (
    AdjacentPhotoNotFound,
    PhotoNotFound,
    build_photo_filters,
    get_adjacent_photo_id as service_get_adjacent_photo_id,
    get_available_filters,
    get_photo_counts,
    get_photo_detail,
    get_photo_file,
    list_photos as service_list_photos,
    set_photo_liked,
)

router = APIRouter()


@router.get("/api/photos")
async def list_photos(
    filter: str = Query("all", pattern="^(all|liked|unliked|system_favorite)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()
    filters = build_photo_filters(filter, sort, focal_length, xiaomi_portrait, vendor_tag)
    content = await service_list_photos(db, filters, page, page_size)

    return JSONResponse(
        content=content,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@router.get("/api/filters")
async def get_filters():
    """Return available filter options derived from the indexed library.
    focal_lengths: sorted list of distinct 35mm-equivalent focal lengths found.
    has_xiaomi_portrait: true if any photo has xiaomi_portrait IN (2,3)."""
    db = await get_db()
    return await get_available_filters(db)


@router.get("/api/photo/{photo_id}")
async def get_photo(
    photo_id: str,
    filter: str = Query(None, pattern="^(all|liked|unliked|system_favorite)$"),
    sort: str = Query(None, pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()
    filters = None
    if filter and sort:
        filters = build_photo_filters(filter, sort, focal_length, xiaomi_portrait, vendor_tag)

    try:
        return await get_photo_detail(db, photo_id, filters)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")


@router.get("/api/thumbnail/{photo_id}")
async def get_thumbnail(photo_id: str, size: int = Query(None)):
    db = await get_db()
    try:
        photo_file = await get_photo_file(db, photo_id)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path = photo_file["absolute_path"]
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    try:
        # Offload blocking CPU-bound Pillow resize to worker threads to avoid freezing the event loop
        thumb_path = await asyncio.to_thread(
            generate_thumbnail,
            abs_path,
            photo_id,
            photo_file["file_size"],
            photo_file["mtime"],
            size,
        )
        return FileResponse(
            thumb_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/original/{photo_id}")
async def get_original(photo_id: str):
    db = await get_db()
    try:
        photo_file = await get_photo_file(db, photo_id)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path = photo_file["absolute_path"]
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    media_type, _ = mimetypes.guess_type(abs_path)
    if not media_type:
        media_type = "application/octet-stream"
    
    return FileResponse(
        abs_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"}
    )


@router.post("/api/like/{photo_id}")
async def like_photo(photo_id: str):
    db = await get_db()
    try:
        result = await set_photo_liked(db, photo_id, True)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")

    announcer.announce("photo_updated", result)
    return result


@router.post("/api/unlike/{photo_id}")
async def unlike_photo(photo_id: str):
    db = await get_db()
    try:
        result = await set_photo_liked(db, photo_id, False)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")

    announcer.announce("photo_updated", result)
    return result


@router.get("/api/counts")
async def get_counts():
    db = await get_db()
    return await get_photo_counts(db)


@router.post("/api/rescan")
async def rescan():
    result = await scan_photos()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/api/auth/verify")
async def verify_auth():
    from app.utils import get_device_name
    return {"status": "ok", "device_name": get_device_name()}


@router.get("/api/events")
async def events_endpoint():
    async def event_generator():
        q = announcer.listen()
        try:
            # Send initial ping to establish connection
            yield "data: {\"event\": \"connected\"}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"event\": \"ping\"}\n\n"
        finally:
            announcer.disconnect(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/api/cache/stats")
async def cache_stats():
    return get_cache_stats()


@router.post("/api/cache/clear")
async def cache_clear():
    return clear_cache()


@router.get("/api/download/{photo_id}")
async def download_photo(photo_id: str):
    db = await get_db()
    try:
        photo_file = await get_photo_file(db, photo_id)
    except PhotoNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")

    abs_path = photo_file["absolute_path"]
    filename = photo_file["filename"]

    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")

    media_type, _ = mimetypes.guess_type(abs_path)
    if not media_type:
        media_type = "application/octet-stream"

    # Explicitly set Content-Disposition: attachment so Android Chrome triggers a save
    # rather than opening the file inline. Also expose filename via X-Filename header.
    headers = {
        "X-Filename": filename,
    }
    return FileResponse(
        abs_path,
        media_type=media_type,
        filename=filename,
        headers=headers,
    )


@router.get("/api/photo/{photo_id}/next")
async def get_next_photo_id(
    photo_id: str,
    filter: str = Query("all", pattern="^(all|liked|unliked|system_favorite)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()
    filters = build_photo_filters(filter, sort, focal_length, xiaomi_portrait, vendor_tag)
    try:
        next_photo_id = await service_get_adjacent_photo_id(db, photo_id, filters, "next")
    except AdjacentPhotoNotFound:
        raise HTTPException(status_code=404, detail="Next photo not found")
    return {"photo_id": next_photo_id}


@router.get("/api/photo/{photo_id}/prev")
async def get_prev_photo_id(
    photo_id: str,
    filter: str = Query("all", pattern="^(all|liked|unliked|system_favorite)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()
    filters = build_photo_filters(filter, sort, focal_length, xiaomi_portrait, vendor_tag)
    try:
        prev_photo_id = await service_get_adjacent_photo_id(db, photo_id, filters, "prev")
    except AdjacentPhotoNotFound:
        raise HTTPException(status_code=404, detail="Previous photo not found")
    return {"photo_id": prev_photo_id}
