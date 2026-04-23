# MeetingNotes — Project Wiki

> **Navigation:** [Home](#meetingnotes--project-wiki) · [Architecture](#architecture-overview) · [Project Structure](#project-structure) · [Data Flow](#data-flow) · [Database Schema](#database-schema) · [Environment Setup](#environment-setup) · [Running the API](#running-the-api) · [Running the Mobile App](#running-the-mobile-app) · [Push Notifications](#push-notifications) · [Background Recording (Android)](#background-recording-android) · [Pause/Resume/Stop from Notification (Android)](#pauseresumeStop-from-notification-android) · [iOS Live Activities](#ios-live-activities)

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
│                                                                   │
│   Android: Foreground service notification                       │
│     └── Pause / Resume / Stop actions from notification          │
│                                                                   │
│   iOS: Live Activity (Dynamic Island + Lock Screen)              │
│     └── Pause / Resume / Stop buttons → deep link → app         │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

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
| Android controls | Pause/Resume/Stop buttons in foreground service notification |
| iOS controls | Live Activity on Dynamic Island & Lock Screen (ActivityKit, iOS 16.2+) |

---

## Project Structure

```
MeetingNotes/
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout — push notification bootstrap
│   ├── liveactivity.tsx        # Invisible screen for Live Activity deep links
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Tab bar layout
│   │   ├── index.tsx           # Record screen (timer, Pause/Resume/Stop state)
│   │   └── meetings.tsx        # Meetings list screen
│   └── meeting/
│       └── [id].tsx            # Meeting detail screen
│
├── hooks/
│   ├── useRecording.ts         # Core recording logic (expo-av, upload, API call,
│   │                           #   timer, Live Activity start/update/end on iOS)
│   ├── useMeetings.ts          # Meetings list data fetching + cache + push refresh
│   └── useMeeting.ts           # Single meeting detail data fetching + cache
│
├── lib/
│   ├── constants.ts            # Shared design tokens, event names, storage keys
│   ├── dateUtils.ts            # parseSupabaseDate, formatDuration
│   ├── meetingStorage.ts       # AsyncStorage cache helpers
│   ├── notifications.ts        # Push token registration + cache
│   └── supabase.ts             # Supabase client (anon key)
│
├── plugins/                    # Expo config plugins (build-time only)
│   ├── withBackgroundAudio.js  # iOS background audio + Android permissions
│   ├── withRecordingService.js # Generates custom Android foreground service
│   └── withLiveActivity.js     # Generates iOS widget extension + native bridge
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
       ├── [iOS]     LiveActivityModule.startActivity(0) ← starts Live Activity
       ├── expo-av Recording.createAsync()
       └── KeepAwake.activateKeepAwakeAsync()

2. User taps Pause (from app, Android notification, or iOS Live Activity)
   └── useRecording.pauseRecording()
       ├── expo-av recording.pauseAsync()
       ├── [Android] RecordingServiceModule.pauseRequest()
       └── [iOS]     useEffect([elapsed, state]) → LiveActivityModule.updateActivity(true, elapsed)

3. User taps Resume
   └── useRecording.resumeRecording()
       ├── expo-av recording.startAsync()
       ├── [Android] RecordingServiceModule.resumeRequest()
       └── [iOS]     useEffect([elapsed, state]) → LiveActivityModule.updateActivity(false, elapsed)

4. User taps Stop
   └── useRecording.stopRecording()
       ├── expo-av recording.stopAndUnloadAsync()
       ├── [Android] RecordingServiceModule.stop()
       ├── [iOS]     LiveActivityModule.endActivity()
       ├── Upload audio → Supabase Storage  (m4a on Android, wav on iOS)
       ├── Generate signed URL (7-day expiry)
       └── POST /process-meeting { audio_url, meeting_id, push_token }

5. Backend receives request (202 Accepted immediately)
   └── background task: audio_processor.process_meeting()
       ├── Download audio from signed URL
       ├── OpenAI Whisper → transcript
       ├── OpenAI GPT-4o → summary
       ├── Supabase: UPDATE meetings SET transcript, summary, status='completed'
       └── Expo Push API → notify device

6. Device receives push notification
   └── Meetings screen refreshes
       └── Fetch from Supabase WHERE push_token = <this device's token>
```

### Viewing Meetings

| Trigger | Behaviour |
|---|---|
| Cold start from notification tap | `_layout.tsx` calls `getLastNotificationResponseAsync()` and navigates to `/meeting/[id]` |
| Foreground notification received | `useMeetings` listener triggers a re-fetch |
| Tab receives focus | `useFocusEffect` triggers a re-fetch |
| Pull-to-refresh | Manual `refresh()` call from `useMeetings` |
| Cache hit | `meetingStorage.ts` loads from `AsyncStorage` first; network response updates the cache |

---

## Database Schema

Supabase table: **`meetings`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key — generated client-side (`Crypto.randomUUID()`) |
| `audio_url` | `text` | Supabase Storage URL |
| `push_token` | `text` | Expo push token — used as device identifier |
| `status` | `text` | `processing` → `completed` / `failed` |
| `transcript` | `text` | Whisper output |
| `summary` | `text` | GPT-4o markdown output |
| `created_at` | `timestamptz` | Auto-set by Supabase |

### RLS Policy

```sql
-- Allow anonymous reads (required for meetings screen)
CREATE POLICY "anon can select meetings"
  ON public.meetings FOR SELECT TO anon USING (true);
```

### Supabase Storage

| Property | Value |
|---|---|
| Bucket name | `audio_meeting_notes` |
| Access | Private (files accessed via time-limited signed URLs) |
| Signed URL TTL | 7 days |

---

## Environment Setup

### Frontend (`.env` in project root)

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://<your-local-ip>:8000
```

> **Important:** Use your machine's LAN IP address (e.g. `192.168.1.x`), not `localhost`, so a physical device on the same network can reach the API.

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

### First-time Setup

```bash
cd backend

# Create virtual environment and install dependencies
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

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | |
| Expo CLI | latest | `npm install -g expo` |
| EAS CLI | latest | `npm install -g eas-cli` |
| Java | 21 | Android Studio JDK at `/Applications/Android Studio.app/Contents/jbr/Contents/Home` |
| Android SDK | — | Set via `ANDROID_HOME=$HOME/Library/Android/sdk` |
| Xcode | latest | iOS builds only |

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
# or to target a specific connected device:
npx expo run:android --device
```

### Run on iOS

```bash
npx expo run:ios --device
# or to target a simulator:
npx expo run:ios
```

### Rebuild After Native Changes

Required when modifying `app.config.js`, any file in `plugins/`, or native dependencies:

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
5. The app receives the notification and the meetings list auto-refreshes.

---

## Background Recording (Android)

`expo-av` 16.x does not implement `staysActiveInBackground` on Android. A custom native foreground service handles this.

### Implementation

| File | Purpose |
|---|---|
| `plugins/withRecordingService.js` | Expo config plugin — generates Kotlin source files and registers the service in `AndroidManifest.xml` at prebuild time |
| `RecordingForegroundService.kt` | Starts a persistent foreground notification with `foregroundServiceType="microphone"` |
| `RecordingServiceModule.kt` | Exposes `start()`, `stop()`, `pauseRequest()`, `resumeRequest()` to React Native via `NativeModules` |
| `RecordingServicePackage.kt` | Registers the module with React Native |

All generated files live inside `android/app/src/main/java/com/tio/meetingnotes/`.

### Android Permissions Required

| Permission | Reason |
|---|---|
| `FOREGROUND_SERVICE` | Required to start a foreground service |
| `FOREGROUND_SERVICE_MICROPHONE` | Required for microphone-type foreground services (Android 13+) |
| `RECORD_AUDIO` | Microphone access |
| `WAKE_LOCK` | Prevent CPU from sleeping during recording |

---

## Pause/Resume/Stop from Notification (Android)

During recording the persistent foreground notification shows three action buttons: **Pause**, **Resume**, and **Stop**. These are implemented entirely in the native Kotlin layer.

### Event Flow

```
User taps "Pause" in notification
  └── Android sends broadcast intent  ACTION_PAUSE
      └── RecordingForegroundService receives it
          ├── Sends event to React Native via RCTDeviceEventEmitter
          │     ("onRecordingStateChange", { state: "pause_requested" })
          └── Updates notification UI: hides Pause, shows Resume

React Native (useRecording.ts)
  └── NativeEventEmitter listener on "onRecordingStateChange"
      └── nativeState === "pause_requested"
          └── recording.pauseAsync() → setState('paused')
```

The foreground service independently manages notification UI state (which buttons are visible) without waiting for the JS layer.

---

## iOS Live Activities

During recording on iOS 16.2+, a **Live Activity** is shown on the Dynamic Island and the Lock Screen displaying a running timer and three action buttons: **Pause**, **Resume**, and **Stop**.

### Event Flow

```
startRecording()
  └── LiveActivityModule.startActivity(0)
      └── ActivityKit starts a Live Activity with RecordingAttributes

Every second (JS timer in useRecording.ts)
  └── useEffect([elapsed, state])
      └── LiveActivityModule.updateActivity(isPaused, elapsedSeconds)
          └── ActivityKit updates ContentState → UI refreshes

Pause button tapped (Dynamic Island / Lock Screen)
  └── SwiftUI Link opens meetingnotes://liveactivity?action=pause
      └── Expo Router navigates to app/liveactivity.tsx
          ├── DeviceEventEmitter.emit('liveActivityAction', { action: 'pause' })
          └── router.back()  ← preserves HomeScreen state (recording ref stays alive)
              └── useRecording listener calls pauseRecording()

stopRecording()
  └── LiveActivityModule.endActivity()
      └── ActivityKit ends the Live Activity
```

### Files Involved

| File | Purpose |
|---|---|
| `plugins/withLiveActivity.js` | Expo config plugin — writes all Swift files and injects Xcode targets at prebuild |
| `ios/RecordingWidget/RecordingAttributes.swift` | Shared `ActivityAttributes` struct (widget target) |
| `ios/RecordingWidget/RecordingWidgetLiveActivity.swift` | SwiftUI UI for Dynamic Island and Lock Screen |
| `ios/RecordingWidget/Info.plist` | Widget extension Info.plist with `NSSupportsLiveActivities: true` |
| `ios/MeetingNotes/LiveActivityModule.swift` | Native bridge (`startActivity`, `updateActivity`, `endActivity`) |
| `ios/MeetingNotes/LiveActivityModule.m` | ObjC bridge header for React Native |
| `app/liveactivity.tsx` | Invisible Expo Router screen — receives deep link, emits event, navigates back |

### Requirements

- iOS 16.2+ (ActivityKit `ActivityContent` API minimum)
- `NSSupportsLiveActivities = YES` in the widget extension's `Info.plist`
- Widget extension target (`RecordingWidget`) sharing the same `ActivityAttributes` struct with the main app
- Deep link scheme `meetingnotes://` configured in `app.config.js`

### Build & Deploy to Physical Device

```bash
# 1. Prebuild (required after any plugin change)
npx expo prebuild --platform ios --clean

# 2. Build
cd ios
xcodebuild \
  -workspace MeetingNotes.xcworkspace \
  -scheme MeetingNotes \
  -configuration Debug \
  -destination "id=<DEVICE_UDID>" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=<TEAM_ID>

# 3. Install
xcrun devicectl device install app --device <DEVICE_UDID> \
  "path/to/DerivedData/.../MeetingNotes.app"

# 4. Launch
xcrun devicectl device process launch --device <DEVICE_UDID> com.tio.meetingnotes.ios
```

> **Note:** Live Activities do **not** work on the iOS Simulator. A physical device running iOS 16.2+ is required.
