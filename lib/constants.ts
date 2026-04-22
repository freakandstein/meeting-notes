// ─── Design tokens ───────────────────────────────────────────────────────────
export const Colors = {
  primary: '#3182ce',
  danger: '#e53e3e',
  warning: '#ed8936',
  success: '#38a169',
  muted: '#718096',
  faint: '#a0aec0',
  dark: '#1a202c',
  darkMid: '#2d3748',
  textMid: '#4a5568',
  border: '#e2e8f0',
  background: '#f7fafc',
  white: '#fff',
  processingBadge: '#d69e2e',
} as const;

// ─── Supabase Storage ─────────────────────────────────────────────────────────
/** Bucket name for audio files. */
export const STORAGE_BUCKET = 'audio_meeting_notes';
/** Path prefix within the bucket. */
export const STORAGE_PATH_PREFIX = 'meetings/';
/** Signed URL TTL: 7 days in seconds. */
export const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

// ─── Recording ────────────────────────────────────────────────────────────────
/** Tag used with expo-keep-awake to prevent the CPU from sleeping. */
export const KEEP_AWAKE_TAG = 'recording';
/** Milliseconds to wait after activating the iOS audio session. */
export const AUDIO_SESSION_WARMUP_MS = 200;

// ─── Native event names ───────────────────────────────────────────────────────
export const EVENTS = {
  /** iOS: emitted when a Live Activity action button is tapped. */
  LIVE_ACTIVITY_ACTION: 'liveActivityAction',
  /** Android: emitted by the foreground service for pause/resume/stop. */
  RECORDING_STATE_CHANGE: 'onRecordingStateChange',
} as const;

// ─── Notifications ────────────────────────────────────────────────────────────
/** Android notification channel vibration pattern. */
export const NOTIFICATION_VIBRATION: number[] = [0, 250, 250, 250];
