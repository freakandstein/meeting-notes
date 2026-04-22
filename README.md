# MeetingNotes

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Data Flow](#data-flow)
4. [Database Schema](#database-schema)
5. [Environment Setup](#environment-setup)
6. [Running the API](#running-the-api)
7. [Running the Mobile App](#running-the-mobile-app)
8. [Push Notifications](#push-notifications)
9. [Background Recording (Android)](#background-recording-android)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mobile App (Expo SDK 54)                  │
│                                                                   │
│   [Record Screen]  ──audio──►  [Supabase Storage]               │
│        │                              │                          │
│        │ signed URL + push_token      │                          │
│        ▼                              │                          │
│   [FastAPI Backend] ◄─────────────────┘                         │
│        │                                                         │
│        ├──► OpenAI Whisper  (transcription)                     │
│        ├──► OpenAI GPT-4o   (summarization)                     │
│        ├──► Supabase DB     (store transcript + summary)        │
│        └──► Expo Push API   (notify device)                     │
│                                                                   │
│   [Meetings Screen] ◄── Supabase DB (filtered by push_token)   │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

| Concern | Solution |
|---|---|
| Audio storage | Supabase Storage bucket `audio_meeting_notes` |
| Database | Supabase Postgres table `meetings` |
| Transcription | OpenAI Whisper via `audio.transcriptions.create` |
| Summarization | OpenAI GPT-4o chat completion |
| Push notifications | Expo Push Notification service (FCM on Android, APNs on iOS) |
| Device isolation | Filter `meetings` by `push_token` column — no login required |
| Local cache | `AsyncStorage` via `lib/meetingStorage.ts` |
| Background recording | Custom Android foreground service (`RecordingForegroundService`) |

---

## Project Structure

```
MeetingNotes/
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout — push notification bootstrap
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Tab bar layout
│   │   ├── index.tsx           # Record screen
│   │   └── meetings.tsx        # Meetings list screen
│   └── meeting/
│       └── [id].tsx            # Meeting detail screen
│
├── hooks/
│   └── useRecording.ts         # Core recording logic (expo-av, upload, API call)
│
├── lib/
│   ├── meetingStorage.ts       # AsyncStorage cache helpers
│   ├── notifications.ts        # Push token registration + cache
│   └── supabase.ts             # Supabase client (anon key)
│
├── plugins/                    # Expo config plugins (build-time only)
│   ├── withBackgroundAudio.js  # iOS background audio + Android permissions
│   └── withRecordingService.js # Generates custom Android foreground service
│
├── types/                      # Shared TypeScript types
│
├── backend/                    # FastAPI server
│   ├── main.py                 # App entry point
│   ├── config.py               # Pydantic settings (reads .env)
│   ├── models/
│   │   └── meeting.py          # Request/response Pydantic models
│   ├── routers/
│   │   └── meeting.py          # POST /process-meeting endpoint
│   └── services/
│       ├── audio_processor.py  # Orchestrates transcribe → summarize → save → notify
│       ├── transcription.py    # OpenAI Whisper wrapper
│       ├── summarizer.py       # OpenAI GPT-4o wrapper
│       ├── supabase_client.py  # Supabase DB helpers (service role key)
│       └── push_notification.py # Expo push notification sender
│
├── app.config.js               # Expo config (bundle IDs, plugins, EAS project ID)
├── eas.json                    # EAS Build profiles
├── google-services.json        # Firebase config (Android)
└── GoogleService-Info.plist    # Firebase config (iOS)
```

---

## Data Flow

### Recording a Meeting

```
1. User taps Record
   └── useRecording.startRecording()
       ├── [Android] RecordingServiceModule.start()  ← foreground service notification
       ├── expo-av Recording.createAsync()
       └── KeepAwake.activateKeepAwakeAsync()

2. User taps Stop
   └── useRecording.stopRecording(meetingId, pushToken)
       ├── expo-av recording.stopAndUnloadAsync()
       ├── [Android] RecordingServiceModule.stop()
       ├── Upload audio → Supabase Storage  (m4a on Android, wav on iOS)
       ├── Generate signed URL (1 hour expiry)
       └── POST /process-meeting { audio_url, meeting_id, push_token }

3. Backend receives request (202 Accepted immediately)
   └── background task: audio_processor.process_meeting()
       ├── Download audio from signed URL
       ├── OpenAI Whisper → transcript
       ├── OpenAI GPT-4o → summary
       ├── Supabase: UPDATE meetings SET transcript, summary, status='done'
       └── Expo Push API → notify device

4. Device receives push notification
   └── Meetings screen refreshes
       └── Fetch from Supabase WHERE push_token = <this device's token>
```

### Viewing Meetings

- **Cold start from notification tap:** `_layout.tsx` calls `getLastNotificationResponseAsync()` and navigates to `/meeting/[id]`
- **Foreground notification received:** listener in `meetings.tsx` triggers a re-fetch
- **Tab focus:** `useFocusEffect` triggers a re-fetch
- **Cache:** `meetingStorage.ts` stores meetings in AsyncStorage — list and detail screens load from cache first, then update from network

---

## Database Schema

Supabase table: **`meetings`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key — generated client-side (`Crypto.randomUUID()`) |
| `audio_url` | `text` | Supabase Storage URL |
| `push_token` | `text` | Expo push token — used as device identifier |
| `status` | `text` | `processing` → `done` |
| `transcript` | `text` | Whisper output |
| `summary` | `text` | GPT-4o output |
| `created_at` | `timestamptz` | Auto-set by Supabase |

**RLS Policies required:**
```sql
-- Allow anonymous reads (required for meetings screen)
CREATE POLICY "anon can select meetings"
  ON public.meetings FOR SELECT TO anon USING (true);
```

**Supabase Storage:**
- Bucket name: `audio_meeting_notes`
- Access: private (files accessed via signed URLs)

---

## Environment Setup

### Frontend (`.env` in project root)

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://<your-local-ip>:8000
```

> Use your machine's local IP (e.g. `192.168.1.x`), not `localhost`, so the physical device can reach the API.

### Backend (`backend/.env`)

```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Running the API

### Prerequisites

- Python 3.9+
- A virtual environment (recommended)

### Steps

```bash
cd backend

# First time — create virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your OpenAI and Supabase keys

# Start the server
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://0.0.0.0:8000`.  
Interactive docs: `http://localhost:8000/docs`

### Subsequent Runs

```bash
cd backend
source .venv/bin/activate
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## Running the Mobile App

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo`
- EAS CLI: `npm install -g eas-cli`
- Android: Android Studio with an emulator or USB-connected device
- iOS: Xcode + a physical device or simulator
- Java 21 (Android Studio JDK):
  ```bash
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  ```

### Install Dependencies

```bash
cd /path/to/MeetingNotes
npm install --legacy-peer-deps
```

### Run on Android

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"

npx expo run:android
```

To target a specific connected device:

```bash
npx expo run:android --device
```

### Run on iOS

```bash
npx expo run:ios --device
```

To target a simulator:

```bash
npx expo run:ios
```

### Rebuild After Native Changes

If you modify `app.config.js`, any file in `plugins/`, or native dependencies, run a clean prebuild first:

```bash
# Android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npx expo prebuild --clean --platform android
npx expo run:android

# iOS
npx expo prebuild --clean --platform ios
npx expo run:ios --device
```

---

## Push Notifications

### Android (FCM)

FCM v1 credentials are stored in EAS. To re-upload:

```bash
eas credentials --platform android
# Select: Push Notifications (FCM V1) → Upload Google Service Account JSON
```

The `google-services.json` file must be present in the project root.

### iOS (APNs)

APNs credentials must be configured via EAS:

```bash
eas credentials --platform ios
# Select: Push Notifications (APNs) → generate or upload a .p8 key
```

The `GoogleService-Info.plist` must be present in the project root.

### How Notifications Work

1. On app launch, `registerForPushNotifications()` in `lib/notifications.ts` requests permission and retrieves an Expo push token.
2. The token is cached in `AsyncStorage` under the key `push_token`.
3. Every recording upload includes this token in the `POST /process-meeting` request body.
4. After processing, the backend calls the Expo Push API with the same token.
5. The app receives the notification and refreshes the meetings list.

---

## Background Recording (Android)

`expo-av` 16.x does not implement `staysActiveInBackground` on Android. A custom native foreground service handles this:

- **Plugin:** `plugins/withRecordingService.js` — generates Kotlin source files and registers the service in `AndroidManifest.xml` at prebuild time.
- **Files generated** (inside `android/app/src/main/java/com/tio/meetingnotes/`):
  - `RecordingForegroundService.kt` — starts a persistent foreground notification with `foregroundServiceType="microphone"`
  - `RecordingServiceModule.kt` — exposes `start()` and `stop()` methods to React Native via `NativeModules`
  - `RecordingServicePackage.kt` — registers the module with React Native
- **Usage in app:** `useRecording.ts` calls `NativeModules.RecordingServiceModule.start()` when recording begins and `.stop()` when it ends.
- **Permissions required** (added by `plugins/withBackgroundAudio.js`):
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_MICROPHONE`
  - `RECORD_AUDIO`
  - `WAKE_LOCK`
