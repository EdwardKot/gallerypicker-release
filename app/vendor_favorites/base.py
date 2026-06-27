class BaseFavoritesAdapter:
    """Base class for per-brand system favorites integration.

    Each adapter handles one brand's quirks for reading and (eventually)
    writing the system favorite state.  The standard Android MediaStore
    path is implemented in StandardAdapter and used as the fallback.

    To add a new brand, subclass this, implement supports() and read_favorites(),
    then register the subclass in vendor_favorites/registry.py above StandardAdapter.

    NOTE: write_favorite() is not defined here yet — OEM write behavior diverges
    significantly and will be designed brand-by-brand during Android app development.
    """

    def supports(self, brand: str) -> bool:
        """Return True if this adapter handles the given brand string.

        brand is lowercase, e.g. "xiaomi", "samsung", "oppo", "unknown".
        The StandardAdapter acts as a catch-all fallback (always True).
        """
        raise NotImplementedError

    def read_favorites(self) -> set:
        """Query the system and return a set of absolute file paths
        that are currently marked as favorites.

        Returns an empty set on any error so callers never crash.
        """
        raise NotImplementedError
