# MeetingNotes Backend — Wiki

> Comprehensive technical documentation covering architecture, data flow, and API specification.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Data Flow](#3-data-flow)
4. [API Specification](#4-api-specification)
5. [Database Schema](#5-database-schema)
6. [External Services](#6-external-services)
7. [Environment Variables](#7-environment-variables)
8. [Error Handling](#8-error-handling)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Native App                         │
│  - Generates meeting UUID                                       │
│  - Uploads audio to Supabase Storage                            │
│  - Calls POST /process-meeting                                  │
│  - Receives push notification when summary is ready             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP POST
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Router: POST /process-meeting                           │   │
│  │  1. INSERT row to Supabase DB  (status: processing)      │   │
│  │  2. Register background task                             │   │
│  │  3. Return 202 immediately                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Background Task (async, non-blocking)                   │   │
│  │  1. Download audio from Supabase Storage URL             │   │
│  │  2. Transcribe via OpenAI Whisper                        │   │
│  │  3. Summarize via GPT-4o                                 │   │
│  │  4. UPDATE row in Supabase DB  (status: completed)       │   │
│  │  5. Send Expo push notification                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────┬─────────────────────────────────┬────────────────────┘
           │                                 │
           ▼                                 ▼
┌─────────────────────┐         ┌────────────────────────┐
│   Supabase          │         │   External APIs         │
│   - Storage (audio) │         │   - OpenAI Whisper      │
│   - DB (meetings)   │         │   - OpenAI GPT-4o       │
└─────────────────────┘         │   - Expo Push Service   │
                                └────────────────────────┘
```

---

## 2. Project Structure

```
Backend/
├── main.py                      # FastAPI app entry point, router registration
├── config.py                    # Pydantic settings, loads from .env
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment variable template
├── docs/
│   └── wiki.md                  # This file
├── models/
│   └── meeting.py               # Pydantic request/response schemas
├── routers/
│   └── meeting.py               # Route definitions
└── services/
    ├── audio_processor.py       # Orchestrates the full background pipeline
    ├── transcription.py         # OpenAI Whisper integration
    ├── summarizer.py            # OpenAI GPT-4o summarization
    ├── supabase_client.py       # Supabase DB operations (insert, update)
    └── push_notification.py    # Expo push notification sender
```

### Module Responsibilities

| Module | Responsibility |
|---|---|
| `main.py` | Creates the FastAPI app and mounts routers |
| `config.py` | Reads and validates env vars using `pydantic-settings` |
| `models/meeting.py` | Defines `ProcessMeetingRequest` and `ProcessMeetingResponse` |
| `routers/meeting.py` | Handles HTTP layer — validates input, calls services, returns response |
| `services/audio_processor.py` | Orchestrates the full pipeline as a background task |
| `services/transcription.py` | Downloads audio and sends to Whisper API |
| `services/summarizer.py` | Sends transcript to GPT-4o and returns structured summary |
| `services/supabase_client.py` | Singleton Supabase client, `insert_meeting`, `update_meeting` |
| `services/push_notification.py` | Sends push notification via Expo Push API |

---

## 3. Data Flow

### 3.1 Happy Path

```
React Native                    FastAPI                      Background Task
     |                             |                               |
     | 1. Generate UUID            |                               |
     | 2. Upload audio to          |                               |
     |    Supabase Storage         |                               |
     |                             |                               |
     |── POST /process-meeting ───▶|                               |
     |   { audio_url,              |                               |
     |     meeting_id,             |                               |
     |     push_token }            |                               |
     |                             |                               |
     |                             |── INSERT meetings ──▶ Supabase DB
     |                             |   { id: meeting_id,           |
     |                             |     audio_url,                |
     |                             |     push_token,               |
     |                             |     status: "processing" }    |
     |                             |                               |
     |                             |── Register background task ──▶|
     |                             |                               |
     |◀── 202 Accepted ────────────|                               |
     |    { message,               |                               |
     |      meeting_id }           |                               |
     |                             |                               |
     | (app continues freely)      |                        Download audio
     |                             |                        from Supabase Storage
     |                             |                               |
     |                             |                        POST Whisper API
     |                             |                        → transcript (text)
     |                             |                               |
     |                             |                        POST GPT-4o API
     |                             |                        → summary (markdown)
     |                             |                               |
     |                             |                        UPDATE meetings
     |                             |                        { transcript,
     |                             |                          summary,
     |                             |                          status: "completed" }
     |                             |                               |
     |                             |                        POST Expo Push API
     |                             |                        "Meeting Summary Ready"
     |                             |                               |
     |◀── Push Notification ───────────────────────────────────────|
```

### 3.2 Error Path

If any step in the background task fails (transcription, summarization, or DB update):

```
Background Task
     |
     |── Exception caught
     |── UPDATE meetings { status: "failed" }
     |── POST Expo Push API → "Processing Failed"
     |── Log error with traceback
```

### 3.3 `meetings` Row Lifecycle

```
[INSERT]  status: "processing"   ← created when API receives request
    ↓
[UPDATE]  status: "completed"    ← transcript + summary written on success
    or
[UPDATE]  status: "failed"       ← on any pipeline error
```

---

## 4. API Specification

### Base URL

```
http://127.0.0.1:8000
```

Interactive docs: `http://127.0.0.1:8000/docs`

---

### `POST /process-meeting`

Inserts a new meeting record and triggers asynchronous audio processing.

**Request**

| Field | Type | Required | Description |
|---|---|---|---|
| `audio_url` | string (URL) | ✅ | Signed or public Supabase Storage URL for the audio file |
| `meeting_id` | string (UUID) | ✅ | UUID generated by the React Native client |
| `push_token` | string | ✅ | Expo push token of the device to notify |

```json
{
  "audio_url": "https://<project>.supabase.co/storage/v1/object/sign/audio_meeting_notes/file.m4a?token=...",
  "meeting_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

**Response — `202 Accepted`**

Returned immediately after the DB insert. Does **not** wait for transcription or summarization.

```json
{
  "message": "Meeting processing started.",
  "meeting_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Error Responses**

| Status | Cause |
|---|---|
| `422 Unprocessable Entity` | Missing or invalid request fields (e.g. invalid URL format) |
| `500 Internal Server Error` | Supabase INSERT failed (e.g. duplicate `meeting_id`) |

---

## 5. Database Schema

Table: `meetings` (Supabase / PostgreSQL)

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Generated by React Native client |
| `user_id` | `uuid` | ID of the user who owns the meeting |
| `audio_url` | `text` | Supabase Storage URL of the audio file |
| `trasncript` | `text` | Raw transcript from Whisper (populated after processing) |
| `summary` | `text` | Markdown summary from GPT-4o (populated after processing) |
| `status` | `text` | `processing` → `completed` or `failed` |
| `push_token` | `text` | Expo push token stored for sending notification |
| `created_at` | `timestamp` | Auto-set by Supabase on insert |

---

## 6. External Services

### OpenAI Whisper

- **Endpoint:** `POST https://api.openai.com/v1/audio/transcriptions`
- **Model:** `whisper-1`
- **Language:** `en` (forced English)
- **Flow:** Audio is downloaded from Supabase Storage into memory, then streamed to Whisper as a file upload

### OpenAI GPT-4o

- **Endpoint:** `POST https://api.openai.com/v1/chat/completions`
- **Model:** `gpt-4o`
- **Temperature:** `0.3`
- **Prompt:** System prompt instructs the model to produce a structured markdown summary with an overview, key discussion points, and next steps

### Supabase

- **Database:** PostgREST API via `supabase-py` client
- **Storage:** Audio files are stored by the React Native app before hitting this API; the API only reads via signed URL
- **Auth:** Uses `service_role` key for full DB access from the backend

### Expo Push Notifications

- **Endpoint:** `POST https://exp.host/--/api/v2/push/send`
- **Token format:** `ExponentPushToken[...]`
- **Notifications sent:**
  - ✅ Success: `"Meeting Summary Ready"`
  - ❌ Failure: `"Processing Failed"`

---

## 7. Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI secret key (from platform.openai.com) |
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (Settings → API) |

---

## 8. Error Handling

| Layer | Strategy |
|---|---|
| **Router** | FastAPI validates request body via Pydantic; returns `422` on invalid input |
| **`insert_meeting`** | Raises `APIError` on DB failure (e.g. duplicate PK); propagates to FastAPI as `500` |
| **`audio_processor`** | Wraps entire pipeline in `try/except`; on failure: updates status to `"failed"`, sends error push notification, logs full traceback |
| **`send_push_notification` (error path)** | Wrapped in its own `try/except` to prevent suppressing the original error if the notification also fails |
