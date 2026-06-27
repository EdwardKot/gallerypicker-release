from dataclasses import dataclass

@dataclass
class TagDefinition:
    tag: str
    label: str
    group: str
    brand: str
    display_order: int = 100

class TagRegistry:
    def __init__(self):
        self._registry: dict[str, TagDefinition] = {
            "brand:xiaomi": TagDefinition(
                tag="brand:xiaomi",
                label="小米",
                group="品牌",
                brand="xiaomi",
                display_order=1
            ),
            "xiaomi:mode:portrait_master": TagDefinition(
                tag="xiaomi:mode:portrait_master",
                label="大师人像",
                group="拍摄模式",
                brand="xiaomi",
                display_order=10
            ),
            "xiaomi:filter:leica_portrait": TagDefinition(
                tag="xiaomi:filter:leica_portrait",
                label="徕卡人像",
                group="滤镜",
                brand="xiaomi",
                display_order=11
            )
        }

    def get(self, tag: str) -> TagDefinition:
        if tag in self._registry:
            return self._registry[tag]
        
        # Fallback rules
        if tag.startswith("brand:"):
            brand_id = tag.split(":", 1)[1]
            label = brand_id.upper()
            group = "品牌"
            brand = brand_id
        else:
            group = "其他"
            if ":" in tag:
                brand = tag.split(":")[0]
            else:
                brand = "unknown"
            label = tag
            
        return TagDefinition(
            tag=tag,
            label=label,
            group=group,
            brand=brand,
            display_order=1000
        )

tag_registry = TagRegistry()
