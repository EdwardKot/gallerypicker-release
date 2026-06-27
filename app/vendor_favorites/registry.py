from .base import BaseFavoritesAdapter
from .standard import StandardAdapter


class FavoritesRegistry:
    """Resolves the correct favorites adapter for a given device brand.

    Adapters are checked in registration order; the first match wins.
    StandardAdapter is always appended last as the catch-all fallback.

    To add a new brand:
        1. Create app/vendor_favorites/<brand>.py with a BaseFavoritesAdapter subclass.
        2. Import it here and add it to self.adapters BEFORE StandardAdapter.

    Example (Samsung, not yet implemented):
        from .samsung import SamsungAdapter
        self.adapters = [SamsungAdapter(), StandardAdapter()]
    """

    def __init__(self):
        self.adapters: list[BaseFavoritesAdapter] = [
            # Brand-specific adapters go here, above the fallback.
            StandardAdapter(),  # catch-all — must stay last
        ]

    def get_adapter(self, brand: str) -> BaseFavoritesAdapter:
        """Return the first adapter that supports the given brand.

        brand should be lowercase (e.g. "xiaomi", "samsung", "oppo").
        Always returns something — StandardAdapter is the final fallback.
        """
        brand_lower = (brand or "").strip().lower()
        for adapter in self.adapters:
            if adapter.supports(brand_lower):
                return adapter
        raise RuntimeError(f"No adapter found for brand '{brand}' — registry misconfigured")


favorites_registry = FavoritesRegistry()
