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
    filter_str: str = "all"           # all | liked | unliked | system_favorite
    sort_str: str = "newest"          # newest | oldest | name_asc | name_desc
    focal_length: Optional[int] = None
    vendor_tag: Optional[str] = None


_SORT_MAP = {
    "newest":    "mtime DESC, photo_id DESC",
    "oldest":    "mtime ASC,  photo_id ASC",
    "name_asc":  "relative_path ASC,  photo_id ASC",
    "name_desc": "relative_path DESC, photo_id DESC",
}

_DEFAULT_SORT = "mtime DESC, photo_id DESC"


def build_filter_sort_sql(f: PhotoFilters) -> tuple[str, str, dict]:
    """Return (where_clause, order_clause, params_dict) for use in photo queries.

    where_clause includes the leading ' WHERE ' token if non-empty, or ''.
    order_clause always includes the leading ' ORDER BY ' token.
    Both are safe to concatenate directly into a query string.
    Note: focal_length is validated as integer by FastAPI before reaching here.
    """
    conditions = []
    params = {}

    if f.filter_str == "liked":
        conditions.append("liked = 1")
    elif f.filter_str == "unliked":
        conditions.append("liked = 0")
    elif f.filter_str == "system_favorite":
        conditions.append("system_favorite = 1")

    if f.focal_length is not None:
        conditions.append(f"focal_length_35mm = {int(f.focal_length)}")

    if f.vendor_tag is not None:
        conditions.append("photo_id IN (SELECT photo_id FROM photo_vendor_tags WHERE tag = :vendor_tag)")
        params["vendor_tag"] = f.vendor_tag

    where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    order_clause = f" ORDER BY {_SORT_MAP.get(f.sort_str, _DEFAULT_SORT)}"
    return where_clause, order_clause, params
