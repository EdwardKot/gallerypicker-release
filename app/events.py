import asyncio
from typing import Set

class EventAnnouncer:
    def __init__(self):
        self.listeners: Set[asyncio.Queue] = set()

    def listen(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.listeners.add(q)
        return q

    def disconnect(self, q: asyncio.Queue):
        self.listeners.discard(q)

    def announce(self, event_type: str, data: dict = None):
        payload = {"event": event_type}
        if data:
            payload.update(data)
        for q in list(self.listeners):
            asyncio.create_task(q.put(payload))

# Global announcer instance
announcer = EventAnnouncer()
