from openai import AsyncOpenAI
from config import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

_SYSTEM_PROMPT = (
    "You are an expert meeting assistant. "
    "Given a meeting transcript, produce a concise, well-structured summary in markdown. "
    "Include: a short overview paragraph, key discussion points as bullet points, "
    "and a 'Next Steps' section if any were mentioned."
)


async def summarize_transcript(transcript: str) -> str:
    """Summarize a meeting transcript using GPT-4o."""
    response = await _openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
        temperature=0.3,
    )
    if not response.choices:
        raise RuntimeError("OpenAI returned no choices (possible content policy violation).")
    content = response.choices[0].message.content
    if content is None:
        raise RuntimeError("OpenAI returned null content.")
    return content
