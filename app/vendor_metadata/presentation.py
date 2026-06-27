from dataclasses import dataclass

from .tag_registry import TagDefinition


_PORTRAIT_MODE_TAGS = {
    "xiaomi:mode:portrait_master",
    "xiaomi:filter:leica_portrait",
}


@dataclass(frozen=True)
class TagPresentation:
    tag: str
    label: str
    group: str
    brand: str
    display_order: int
    visible: bool = True

    @classmethod
    def from_definition(cls, tag_def: TagDefinition, show_raw: bool = False) -> "TagPresentation":
        group = tag_def.group
        display_order = tag_def.display_order
        visible = show_raw or ":raw:" not in tag_def.tag

        if tag_def.tag in _PORTRAIT_MODE_TAGS:
            group = "人像模式"

        # Presentation only changes UI-facing fields and visibility. The
        # underlying tag and brand must stay stable for filtering/debugging.
        return cls(
            tag=tag_def.tag,
            label=tag_def.label,
            group=group,
            brand=tag_def.brand,
            display_order=display_order,
            visible=visible,
        )
