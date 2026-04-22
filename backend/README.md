# MeetingNotes — Backend API

FastAPI backend for processing meeting audio recordings from a React Native app.

## Features

- Accepts a Supabase audio URL and processes it asynchronously
- Transcribes audio using **OpenAI Whisper**
- Summarizes the transcript using **GPT-4o**
- Stores results (`transcript`, `summary`, `status`) in **Supabase**
- Sends an **Expo push notification** when processing is complete

---

## Project Structure

```
Backend/
├── main.py                      # FastAPI app entry point
├── config.py                    # Environment variable settings
├── requirements.txt
├── .env.example
├── models/
│   └── meeting.py               # Request / Response schemas
├── routers/
│   └── meeting.py               # POST /process-meeting
└── services/
    ├── audio_processor.py       # Orchestrates the full pipeline
    ├── transcription.py         # OpenAI Whisper
    ├── summarizer.py            # GPT-4o summarization
    ├── supabase_client.py       # Supabase insert & update
    └── push_notification.py    # Expo push notifications
```

---

## Supabase Table

Table name: `meetings`

| Column | Type |
|---|---|
| `id` | uuid (primary key) |
| `audio_url` | text |
| `trasncript` | text |
| `summary` | text |
| `status` | text |
| `push_token` | text |
| `created_at` | timestamp |

---

## Setup

**1. Clone and enter the directory**
```bash
cd Backend
```

**2. Install dependencies**
```bash
pip3 install -r requirements.txt
```

**3. Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` and fill in:
```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**4. Run the server**
```bash
python3 -m uvicorn main:app --reload
```

Server runs at `http://127.0.0.1:8000`

---

## API

### `POST /process-meeting`

Inserts a new meeting row, then asynchronously transcribes and summarizes the audio.

**Request body**
```json
{
  "audio_url": "https://<project>.supabase.co/storage/v1/object/sign/...",
  "meeting_id": "uuid-generated-by-client",
  "push_token": "ExponentPushToken[...]"
}
```

**Response — 202 Accepted**
```json
{
  "message": "Meeting processing started.",
  "meeting_id": "uuid-generated-by-client"
}
```

**Async flow**

React Native only waits for the INSERT to complete before receiving a 202 response.
All heavy processing runs in the background — the app does not block.

```
React Native                    API                         Background
     |                           |                               |
     |--- POST /process-meeting →|                               |
     |                           |-- INSERT meetings (processing)|
     |                           |-- register background task ---|→ (runs independently)
     |←-- 202 Accepted ----------|                               |
     |   (done, app is free)     |                        Whisper transcription
     |                           |                        GPT-4o summarization
     |                           |                        UPDATE meetings (completed)
     |                           |                        Expo push notification
     |←---------------------------------------- push notification arrives
```

On failure: `status` is set to `"failed"` and an error push notification is sent.

---

## Interactive Docs

Swagger UI available at `http://127.0.0.1:8000/docs` when the server is running.
