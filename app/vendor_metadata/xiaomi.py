from .base import BaseMetadataExtractor

class XiaomiExtractor(BaseMetadataExtractor):
    def supports(self, make: str, model: str) -> bool:
        make_lower = (make or "").strip().lower()
        return "xiaomi" in make_lower or "redmi" in make_lower or "poco" in make_lower

    def extract(self, exif: dict, exif_sub: dict) -> list[tuple[str, str]]:
        tags = []
        tags.append(("brand:xiaomi", "exif"))
        
        if not exif_sub:
            return tags
            
        # Tag 0x889F (portrait mode)
        portrait = exif_sub.get(0x889F)
        if portrait is not None:
            val = None
            if isinstance(portrait, bytes) and len(portrait) > 0:
                val = int(portrait[0])
            elif isinstance(portrait, (int, float)):
                val = int(portrait)
            
            if val is not None:
                if val == 2:
                    tags.append(("xiaomi:mode:portrait_master", "exif"))
                elif val == 3:
                    tags.append(("xiaomi:filter:leica_portrait", "exif"))
                else:
                    tags.append((f"xiaomi:raw:0x889f:{val}", "exif"))

        # Tag 0x8889 (scene mode / filter)
        scene = exif_sub.get(0x8889)
        if scene is not None:
            val = None
            if isinstance(scene, bytes) and len(scene) > 0:
                val = int(scene[0])
            elif isinstance(scene, (int, float)):
                val = int(scene)
            
            if val is not None:
                tags.append((f"xiaomi:raw:0x8889:{val}", "exif"))

        return tags
