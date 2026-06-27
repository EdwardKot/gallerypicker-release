class BaseMetadataExtractor:
    def supports(self, make: str, model: str) -> bool:
        raise NotImplementedError
        
    def extract(self, exif: dict, exif_sub: dict) -> list[tuple[str, str]]:
        raise NotImplementedError
