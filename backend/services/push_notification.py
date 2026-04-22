from __future__ import annotations

import httpx

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push_notification(
    push_token: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> None:
    """Send an Expo push notification to the given push_token."""
    payload = {
        "to": push_token,
        "title": title,
        "body": body,
        "sound": "default",
    }
    if data:
        payload["data"] = data

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            EXPO_PUSH_URL,
            json=payload,
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        result = response.json()
        import logging
        logger = logging.getLogger(__name__)
        logger.info("Expo push response: %s", result)
        # data can be a dict (single notification) or list (batch)
        data_field = result.get("data", [])
        items = [data_field] if isinstance(data_field, dict) else data_field
        for item in items:
            if isinstance(item, dict) and item.get("status") == "error":
                logger.error("Push error: %s", item)
