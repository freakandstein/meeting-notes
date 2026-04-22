import io
import httpx
from openai import AsyncOpenAI
from config import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)


async def transcribe_audio(audio_url: str) -> str:
    """Download audio from audio_url and transcribe it using OpenAI Whisper."""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.get(audio_url)
        response.raise_for_status()
        audio_bytes = response.content

    # Derive a filename from the URL for the MIME-type hint
    filename = audio_url.split("?")[0].rsplit("/", 1)[-1] or "audio.m4a"
    audio_file = (filename, io.BytesIO(audio_bytes))

    transcription = await _openai.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        language="en",
    )
    return transcription.text
