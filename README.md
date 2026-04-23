# MeetingNotes

A mobile app that records meetings, transcribes them using OpenAI Whisper, summarizes them with GPT-4o, and pushes the result back to your device.

> Full technical documentation → [WIKI.md](./WIKI.md)

---

## How to Run Locally

### Prerequisites

**General**
- Node.js 18+
- Python 3.9+
- Expo SDK 54 (`npx expo --version` should show `0.22.x`)
- [Expo account](https://expo.dev) + EAS CLI (`npm install -g eas-cli`)
- [Supabase](https://supabase.com) project with:
  - Postgres table `meetings` (see schema below)
  - Storage bucket `audio_meeting_notes` (private)
  - RLS policy allowing anon `SELECT` on `meetings`
- OpenAI API key (Whisper + GPT-4o access required)

**Android**
- Android Studio with a connected device or emulator
- Java 21 JDK (bundled with Android Studio)

**iOS** *(macOS only)*
- Xcode 15+
- Physical iOS device running iOS 16.2+ (Live Activities & push notifications don't work on simulator)

#### Supabase `meetings` table schema

```sql
create table public.meetings (
  id          uuid        primary key,
  audio_url   text,
  push_token  text,
  status      text        default 'processing',
  transcript  text,
  summary     text,
  created_at  timestamptz default now()
);

-- Allow anonymous reads
create policy "anon can select meetings"
  on public.meetings for select to anon using (true);
```

### 1. Clone & install

```bash
git clone <repo-url>
cd MeetingNotes
npm install --legacy-peer-deps
```

### 2. Configure environment

**Frontend** — create `.env` in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://<your-local-ip>:8000
```

> Use your machine's LAN IP (e.g. `192.168.1.x`), not `localhost`, so a physical device can reach the API.

**Backend** — create `backend/.env`:

```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 3. Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Run the mobile app

**Android:**

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npx expo run:android
```

**iOS:**

```bash
npx expo run:ios --device
```

---

## Architecture Decisions

```mermaid
flowchart LR
    A[Mobile App] -->|upload audio| B[Supabase Storage]
    B -->|signed URL| C[FastAPI Backend]
    C -->|transcribe| D[OpenAI Whisper]
    C -->|summarize| E[OpenAI GPT-4o]
    C -->|save result| F[Supabase DB]
    C -->|push| G[Expo Push API]
    G -->|notification| A
    A -->|read meetings| F
```

| Decision | Rationale |
|---|---|
| **FastAPI + background task** | Returns `202 Accepted` immediately; processing (transcription + summarization) happens async without blocking the client |
| **Supabase Storage for audio** | Avoids sending large audio files directly to the API; backend downloads via signed URL only when ready to process |
| **Push token as device identity** | No login required — each device is identified by its Expo push token, keeping the UX frictionless |
| **Custom Android foreground service** | `expo-av` doesn't support `staysActiveInBackground` on Android; a native Kotlin foreground service keeps the microphone alive when the app is backgrounded |
| **iOS Live Activities (ActivityKit)** | Surfaces recording controls (Pause/Resume/Stop) on the Dynamic Island and Lock Screen without the user needing to re-open the app |
| **Local AsyncStorage cache** | Meetings list loads instantly from cache on every app open; network response updates the cache in the background |

---

## What I'd Improve With More Time

*(Coming soon)*

---
