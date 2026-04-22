from __future__ import annotations

import asyncio

from supabase import create_client, Client
from config import settings

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


async def insert_meeting(meeting_id: str, audio_url: str, push_token: str) -> None:
    """Insert a new row into the meetings table using the meeting_id from the client."""
    client = get_supabase()

    def _insert() -> None:
        response = client.table("meetings").insert(
            {"id": meeting_id, "audio_url": audio_url, "push_token": push_token, "status": "processing"}
        ).execute()
        if not response.data:
            raise RuntimeError(f"Supabase insert returned no data: {response}")

    await asyncio.to_thread(_insert)


async def update_meeting(meeting_id: str, data: dict) -> None:
    """Update columns on the meetings table for the given meeting_id."""
    client = get_supabase()

    def _update() -> None:
        response = client.table("meetings").update(data).eq("id", meeting_id).execute()
        if not response.data:
            raise RuntimeError(f"Supabase update returned no data: {response}")

    await asyncio.to_thread(_update)
