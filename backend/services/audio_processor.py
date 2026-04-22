import logging

from services.transcription import transcribe_audio
from services.summarizer import summarize_transcript
from services.supabase_client import update_meeting
from services.push_notification import send_push_notification

logger = logging.getLogger(__name__)


async def process_meeting(audio_url: str, meeting_id: str, push_token: str) -> None:
    """
    Background task that:
    1. Transcribes the meeting audio via OpenAI Whisper
    2. Summarizes the transcript via GPT-4o
    3. Updates the meetings table in Supabase
    4. Sends an Expo push notification
    """
    try:
        # Step 1 — Transcribe
        logger.info("Transcribing audio for meeting %s", meeting_id)
        transcript = await transcribe_audio(audio_url)

        # Step 2 — Summarize
        logger.info("Summarizing transcript for meeting %s", meeting_id)
        summary = await summarize_transcript(transcript)

        # Step 3 — Persist results
        await update_meeting(
            meeting_id,
            {
                "transcript": transcript,  # column name as defined in Supabase
                "summary": summary,
                "status": "completed",
            },
        )
        logger.info("Meeting %s updated in Supabase", meeting_id)

        # Step 4 — Push notification
        await send_push_notification(
            push_token=push_token,
            title="Meeting Summary Ready",
            body="Your meeting has been processed. Tap to view the summary.",
            data={"meeting_id": meeting_id},
        )
        logger.info("Push notification sent for meeting %s", meeting_id)

    except Exception as exc:
        logger.exception("Failed to process meeting %s: %s", meeting_id, exc)
        await update_meeting(meeting_id, {"status": "failed"})
        # Best-effort error notification
        try:
            await send_push_notification(
                push_token=push_token,
                title="Processing Failed",
                body="We couldn't process your meeting. Please try again.",
                data={"meeting_id": meeting_id},
            )
        except Exception:
            logger.exception("Failed to send error push notification for meeting %s", meeting_id)
