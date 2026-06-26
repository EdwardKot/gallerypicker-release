import os
import asyncio
import mimetypes
from datetime import datetime, timezone
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import json
from app.database import get_db
from app.events import announcer
from app.scanner import scan_photos
from app.thumbnails import generate_thumbnail, get_cache_stats, clear_cache
from app.config import PHOTO_ROOT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.queries import PhotoFilters, build_filter_sort_sql
from typing import Optional

router = APIRouter()


def parse_vendor_tag(vendor_tag: Optional[str]) -> Optional[int]:
    if vendor_tag in ("xiaomi_portrait=0", "xiaomi_portrait=2", "xiaomi_portrait=3"):
        return int(vendor_tag.split("=")[1])
    return None


@router.get("/api/photos")
async def list_photos(
    filter: str = Query("all", pattern="^(all|liked|unliked)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()

    if vendor_tag and xiaomi_portrait is None:
        xiaomi_portrait = parse_vendor_tag(vendor_tag)

    # Cap page_size to MAX_PAGE_SIZE unless filter is 'liked' (which needs to fetch all liked photo IDs)
    if filter != "liked":
        page_size = min(page_size, MAX_PAGE_SIZE)
    else:
        page_size = min(page_size, 100000)

    where, order = build_filter_sort_sql(PhotoFilters(
        filter_str=filter,
        sort_str=sort,
        focal_length=focal_length,
        xiaomi_portrait=xiaomi_portrait
    ))
    params = []

    count_query = f"SELECT COUNT(*) FROM photos{where}"
    cursor = await db.execute(count_query, params)
    row = await cursor.fetchone()
    total = row[0]

    offset = (page - 1) * page_size
    base = "SELECT photo_id, relative_path, file_size, mtime, liked FROM photos"
    query = base + where + order + " LIMIT ? OFFSET ?"
    cursor = await db.execute(query, params + [page_size, offset])
    rows = await cursor.fetchall()

    photos = []
    for row in rows:
        photos.append({
            "photo_id": row[0],
            "relative_path": row[1],
            "file_size": row[2],
            "mtime": row[3],
            "liked": bool(row[4]),
            "filename": os.path.basename(row[1])
        })

    return JSONResponse(
        content={
            "photos": photos,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        },
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@router.get("/api/filters")
async def get_filters():
    """Return available filter options derived from the indexed library.
    focal_lengths: sorted list of distinct 35mm-equivalent focal lengths found.
    has_xiaomi_portrait: true if any photo has xiaomi_portrait IN (2,3)."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT DISTINCT focal_length_35mm FROM photos "
        "WHERE focal_length_35mm IS NOT NULL ORDER BY focal_length_35mm ASC"
    )
    focal_lengths = [row[0] for row in await cursor.fetchall()]

    cursor = await db.execute(
        "SELECT COUNT(*) FROM photos WHERE xiaomi_portrait IN (2, 3)"
    )
    xiaomi_count = (await cursor.fetchone())[0]

    available_vendor_tags = []
    if xiaomi_count > 0:
        available_vendor_tags = [
            {"id": "xiaomi_portrait=0", "display_name": "All Portrait (人像模式)", "vendor": "Xiaomi"},
            {"id": "xiaomi_portrait=2", "display_name": "Master Portrait (大师人像)", "vendor": "Xiaomi"},
            {"id": "xiaomi_portrait=3", "display_name": "Leica Portrait (徕卡人像)", "vendor": "Xiaomi"}
        ]

    return {
        "focal_lengths": focal_lengths,
        "has_xiaomi_portrait": xiaomi_count > 0,
        "available_vendor_tags": available_vendor_tags,
    }


@router.get("/api/photo/{photo_id}")
async def get_photo(
    photo_id: str,
    filter: str = Query(None, pattern="^(all|liked|unliked)$"),
    sort: str = Query(None, pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()

    if vendor_tag and xiaomi_portrait is None:
        xiaomi_portrait = parse_vendor_tag(vendor_tag)

    cursor = await db.execute(
        """SELECT photo_id, relative_path, absolute_path, file_size, mtime,
                  width, height, liked
           FROM photos
           WHERE photo_id = ?""",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    res = {
        "photo_id": row[0],
        "relative_path": row[1],
        "absolute_path": row[2],
        "file_size": row[3],
        "mtime": row[4],
        "width": row[5],
        "height": row[6],
        "liked": bool(row[7]),
        "filename": os.path.basename(row[1])
    }
    
    if filter and sort:
        where_clause, order_clause = build_filter_sort_sql(PhotoFilters(
            filter_str=filter,
            sort_str=sort,
            focal_length=focal_length,
            xiaomi_portrait=xiaomi_portrait
        ))
        query = f"""
            WITH ordered AS (
                SELECT photo_id,
                       ROW_NUMBER() OVER ({order_clause}) as row_num
                FROM photos
                {where_clause}
            ),
            target AS (
                SELECT row_num, (SELECT COUNT(*) FROM ordered) as total
                FROM ordered
                WHERE photo_id = ?
            )
            SELECT o.photo_id, o.row_num, t.row_num as target_row_num, t.total
            FROM ordered o
            CROSS JOIN target t
            WHERE o.row_num BETWEEN t.row_num - 3 AND t.row_num + 3
        """
        try:
            cursor = await db.execute(query, (photo_id,))
            neighbor_rows = await cursor.fetchall()
            
            prev_ids = []
            next_ids = []
            target_row_num = None
            total = 0
            
            for r in neighbor_rows:
                p_id, r_num, t_r_num, tot = r[0], r[1], r[2], r[3]
                target_row_num = t_r_num
                total = tot
                
                if r_num < t_r_num:
                    prev_ids.append(p_id)
                elif r_num > t_r_num:
                    next_ids.append(p_id)
                    
            res.update({
                "index": target_row_num,
                "total": total,
                "prev_photo_id": prev_ids[-1] if prev_ids else None,
                "next_photo_id": next_ids[0] if next_ids else None,
                "prev_ids": prev_ids,
                "next_ids": next_ids
            })
        except Exception as e:
            print(f"[get_photo] neighbor query failed for {photo_id}: {e}")
            res.update({
                "index": -1,
                "total": 0,
                "prev_photo_id": None,
                "next_photo_id": None,
                "prev_ids": [],
                "next_ids": []
            })
            
    return res


@router.get("/api/thumbnail/{photo_id}")
async def get_thumbnail(photo_id: str, size: int = Query(None)):
    db = await get_db()
    cursor = await db.execute(
        "SELECT absolute_path, file_size, mtime FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path, file_size, mtime = row[0], row[1], row[2]
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    try:
        # Offload blocking CPU-bound Pillow resize to worker threads to avoid freezing the event loop
        thumb_path = await asyncio.to_thread(
            generate_thumbnail, abs_path, photo_id, file_size, mtime, size
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
    cursor = await db.execute(
        "SELECT absolute_path FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path = row[0]
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
    cursor = await db.execute("SELECT photo_id FROM photos WHERE photo_id = ?", (photo_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Photo not found")
    
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE photos SET liked = 1, updated_at = ? WHERE photo_id = ?",
        (now, photo_id)
    )
    await db.commit()
    announcer.announce("photo_updated", {"photo_id": photo_id, "liked": True})
    return {"photo_id": photo_id, "liked": True}


@router.post("/api/unlike/{photo_id}")
async def unlike_photo(photo_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT photo_id FROM photos WHERE photo_id = ?", (photo_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Photo not found")
    
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE photos SET liked = 0, updated_at = ? WHERE photo_id = ?",
        (now, photo_id)
    )
    await db.commit()
    announcer.announce("photo_updated", {"photo_id": photo_id, "liked": False})
    return {"photo_id": photo_id, "liked": False}


@router.get("/api/counts")
async def get_counts():
    db = await get_db()
    
    cursor = await db.execute("SELECT COUNT(*) FROM photos")
    total = (await cursor.fetchone())[0]
    
    cursor = await db.execute(
        "SELECT COUNT(*) FROM photos WHERE liked = 1"
    )
    liked = (await cursor.fetchone())[0]
    
    return {
        "total": total,
        "liked": liked,
        "unliked": total - liked
    }


@router.post("/api/rescan")
async def rescan():
    result = await scan_photos()
    announcer.announce("library_updated")
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
    cursor = await db.execute(
        "SELECT absolute_path, relative_path FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    abs_path = row[0]
    filename = os.path.basename(row[1])

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
    filter: str = Query("all", pattern="^(all|liked|unliked)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()

    if vendor_tag and xiaomi_portrait is None:
        xiaomi_portrait = parse_vendor_tag(vendor_tag)

    where_clause, order_clause = build_filter_sort_sql(PhotoFilters(
        filter_str=filter,
        sort_str=sort,
        focal_length=focal_length,
        xiaomi_portrait=xiaomi_portrait
    ))
    query = f"""
        WITH ordered AS (
            SELECT photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos
            {where_clause}
        ),
        target AS (
            SELECT row_num FROM ordered WHERE photo_id = ?
        )
        SELECT o.photo_id
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num = t.row_num + 1
    """
    cursor = await db.execute(query, (photo_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Next photo not found")
    return {"photo_id": row[0]}


@router.get("/api/photo/{photo_id}/prev")
async def get_prev_photo_id(
    photo_id: str,
    filter: str = Query("all", pattern="^(all|liked|unliked)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|name_asc|name_desc)$"),
    focal_length: int = Query(None),
    xiaomi_portrait: int = Query(None),
    vendor_tag: str = Query(None),
):
    db = await get_db()

    if vendor_tag and xiaomi_portrait is None:
        xiaomi_portrait = parse_vendor_tag(vendor_tag)

    where_clause, order_clause = build_filter_sort_sql(PhotoFilters(
        filter_str=filter,
        sort_str=sort,
        focal_length=focal_length,
        xiaomi_portrait=xiaomi_portrait
    ))
    query = f"""
        WITH ordered AS (
            SELECT photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos
            {where_clause}
        ),
        target AS (
            SELECT row_num FROM ordered WHERE photo_id = ?
        )
        SELECT o.photo_id
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num = t.row_num - 1
    """
    cursor = await db.execute(query, (photo_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Previous photo not found")
    return {"photo_id": row[0]}
