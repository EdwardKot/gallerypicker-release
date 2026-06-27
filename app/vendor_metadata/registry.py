from typing import Optional
from .base import BaseMetadataExtractor
from .xiaomi import XiaomiExtractor

class ExtractorRegistry:
    def __init__(self):
        self.extractors: list[BaseMetadataExtractor] = [
            XiaomiExtractor()
        ]

    def get_extractor(self, make: str, model: str) -> Optional[BaseMetadataExtractor]:
        for ext in self.extractors:
            if ext.supports(make, model):
                return ext
        return None

registry = ExtractorRegistry()
