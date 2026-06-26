# app/queries.py
# Central home for all filter/sort SQL builders.
# When adding a new EXIF-based filter, extend PhotoFilters and build_filter_sort_sql only.

from dataclasses import dataclass
from typing import Optional


@dataclass
class PhotoFilters:
    """Typed container for all filter parameters.
    Add new filter fields here as the schema grows.
    """
    filter_str: str = "all"           # all | liked | unliked
    sort_str: str = "newest"          # newest | oldest | name_asc | name_desc
    focal_length: Optional[int] = None
    xiaomi_portrait: Optional[int] = None
    # Future: oppo_zoom: Optional[int] = None
    # Future: realme_mode: Optional[int] = None


_SORT_MAP = {
    "newest":    "mtime DESC, photo_id DESC",
    "oldest":    "mtime ASC,  photo_id ASC",
    "name_asc":  "relative_path ASC,  photo_id ASC",
    "name_desc": "relative_path DESC, photo_id DESC",
}

_DEFAULT_SORT = "mtime DESC, photo_id DESC"


def build_filter_sort_sql(f: PhotoFilters) -> tuple[str, str]:
    """Return (where_clause, order_clause) for use in photo queries.

    where_clause includes the leading ' WHERE ' token if non-empty, or ''.
    order_clause always includes the leading ' ORDER BY ' token.
    Both are safe to concatenate directly into a query string.
    Note: focal_length and xiaomi_portrait values are validated as integers
    by FastAPI before reaching here, so f-string interpolation is safe.
    """
    conditions = []

    if f.filter_str == "liked":
        conditions.append("liked = 1")
    elif f.filter_str == "unliked":
        conditions.append("liked = 0")

    if f.focal_length is not None:
        conditions.append(f"focal_length_35mm = {int(f.focal_length)}")

    if f.xiaomi_portrait is not None:
        if f.xiaomi_portrait == 0:
            conditions.append("xiaomi_portrait IN (2, 3)")
        else:
            conditions.append(f"xiaomi_portrait = {int(f.xiaomi_portrait)}")

    # Future filters slot in here, same pattern:
    # if f.oppo_zoom is not None:
    #     conditions.append(f"oppo_zoom = {int(f.oppo_zoom)}")

    where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    order_clause = f" ORDER BY {_SORT_MAP.get(f.sort_str, _DEFAULT_SORT)}"
    return where_clause, order_clause
