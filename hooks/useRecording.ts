import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import {
  Audio,
  InterruptionModeAndroid,
  InterruptionModeIOS,
} from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as KeepAwake from 'expo-keep-awake';
import { supabase } from '../lib/supabase';
import {
  AUDIO_SESSION_WARMUP_MS,
  EVENTS,
  KEEP_AWAKE_TAG,
  SIGNED_URL_TTL,
  STORAGE_BUCKET,
  STORAGE_PATH_PREFIX,
} from '../lib/constants';

const { RecordingServiceModule, LiveActivityModule } = NativeModules;

const apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL environment variable is not set.');
}

export type RecordingState = 'idle' | 'recording' | 'paused' | 'uploading';

/**
 * Decodes a base64 string into an ArrayBuffer for Supabase Storage upload.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useRecording() {
  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  // Stored at start time so pause/resume handlers always have access
  const meetingIdRef = useRef<string>('');
  const pushTokenRef = useRef<string>('');
  // Mutable ref so the NativeEventEmitter stop_requested handler can call the latest stopRecording
  const stopRecordingRef = useRef<(() => void) | null>(null);

  // Timer refs — wall-clock segment tracking for accurate elapsed across pause/resume
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);

  // Timer: accumulates elapsed time across pause/resume cycles
  useEffect(() => {
    if (state === 'recording') {
      segmentStartRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        if (segmentStartRef.current != null) {
          setElapsed(
            accumulatedRef.current +
              Math.floor((Date.now() - segmentStartRef.current) / 1000)
          );
        }
      }, 1000);

      // Re-sync elapsed when app is foregrounded after being backgrounded
      const sub = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active' && segmentStartRef.current != null) {
          setElapsed(
            accumulatedRef.current +
              Math.floor((Date.now() - segmentStartRef.current) / 1000)
          );
        }
      });

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        sub.remove();
      };
    } else if (state === 'paused') {
      // Commit current segment duration before freezing the timer
      if (segmentStartRef.current != null) {
        accumulatedRef.current += Math.floor(
          (Date.now() - segmentStartRef.current) / 1000
        );
        segmentStartRef.current = null;
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (state === 'idle') {
        segmentStartRef.current = null;
        accumulatedRef.current = 0;
        setElapsed(0);
      }
    }
  }, [state]);

  // iOS: sync elapsed time + pause state to Live Activity every tick
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (state === 'recording') {
      LiveActivityModule?.updateActivity(false, elapsed);
    } else if (state === 'paused') {
      LiveActivityModule?.updateActivity(true, elapsed);
    }
  }, [elapsed, state]);

  // iOS: handle Pause/Resume/Stop button taps from the Live Activity
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = DeviceEventEmitter.addListener(
      EVENTS.LIVE_ACTIVITY_ACTION,
      ({ action }: { action: string }) => {
        if (action === 'pause') pauseRecording();
        else if (action === 'resume') resumeRecording();
        else if (action === 'stop') stopRecordingRef.current?.();
      }
    );
    return () => sub.remove();
  }, []);

  // Android: listen to native events from the foreground service (pause/resume/stop
  // initiated by notification action buttons while the app is backgrounded).
  useEffect(() => {
    if (Platform.OS !== 'android' || !RecordingServiceModule) return;
    const emitter = new NativeEventEmitter(RecordingServiceModule);
    const sub = emitter.addListener(
      EVENTS.RECORDING_STATE_CHANGE,
      async ({ state: nativeState }: { state: string }) => {
        const recording = recordingRef.current;
        if (!recording) return;
        if (nativeState === 'pause_requested') {
          try {
            await recording.pauseAsync();
            setState('paused');
          } catch {
            // Ignore — state already paused or recording ended
          }
        } else if (nativeState === 'resume_requested') {
          try {
            await recording.startAsync();
            setState('recording');
          } catch {
            // Ignore — state already recording or recording ended
          }
        } else if (nativeState === 'stop_requested') {
          stopRecordingRef.current?.();
        }
      }
    );
    return () => sub.remove();
  }, []);

  const startRecording = useCallback(async (meetingId: string, pushToken: string) => {
    try {
      setError(null);
      meetingIdRef.current = meetingId;
      pushTokenRef.current = pushToken;

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setError('Microphone permission denied.');
        return;
      }

      // Set audio mode to allow recording and background audio
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      // Give iOS time to activate the audio session before preparing recorder
      await new Promise((resolve) => setTimeout(resolve, AUDIO_SESSION_WARMUP_MS));

      // Start Live Activity on iOS
      if (Platform.OS === 'ios') {
        LiveActivityModule?.startActivity(0);
      }

      const { recording } = await Audio.Recording.createAsync(
        Platform.OS === 'ios'
          ? {
              // iOS-compatible options: use LinearPCM to avoid AAC session issues
              isMeteringEnabled: true,
              android: Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
              ios: {
                extension: '.wav',
                outputFormat: Audio.IOSOutputFormat.LINEARPCM,
                audioQuality: Audio.IOSAudioQuality.HIGH,
                sampleRate: 44100,
                numberOfChannels: 1,
                bitRate: 128000,
                linearPCMBitDepth: 16,
                linearPCMIsBigEndian: false,
                linearPCMIsFloat: false,
              },
              web: Audio.RecordingOptionsPresets.HIGH_QUALITY.web,
            }
          : Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      // Start native foreground service (keeps process alive when screen locks)
      if (Platform.OS === 'android') {
        RecordingServiceModule?.start();
      }
      // Prevent CPU from sleeping while recording
      await KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      setState('recording');
    } catch (err) {
      setError('Failed to start recording.');
    }
  }, []);

  const pauseRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.pauseAsync();
      if (Platform.OS === 'android') {
        RecordingServiceModule?.pauseRequest();
      }
      setState('paused');
    } catch {
      // Ignore — recording may have already stopped
    }
  }, []);

  const resumeRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.startAsync();
      if (Platform.OS === 'android') {
        RecordingServiceModule?.resumeRequest();
      }
      setState('recording');
    } catch {
      // Ignore — recording may have already stopped
    }
  }, []);

  /**
   * Stops the recording, uploads the audio to Supabase Storage,
   * then calls the backend API to kick off processing.
   * meetingId and pushToken were captured at startRecording time.
   */
  const stopRecording = useCallback(async (): Promise<void> => {
    const recording = recordingRef.current;
    if (!recording) return;
    const meetingId = meetingIdRef.current;
    const pushToken = pushTokenRef.current;

    try {
      setState('uploading');

      await recording.stopAndUnloadAsync();

      // Stop native foreground service
      if (Platform.OS === 'android') {
        RecordingServiceModule?.stop();
      }
      // End Live Activity on iOS
      if (Platform.OS === 'ios') {
        LiveActivityModule?.endActivity();
      }
      // Release wake lock after recording stops
      KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);

      // Restore audio mode after recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
      });

      const uri = recording.getURI();
      if (!uri) throw new Error('No recording URI.');

      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) throw new Error('Recording file not found.');

      // Upload to Supabase Storage
      const ext = Platform.OS === 'ios' ? 'wav' : 'm4a';
      const contentType = Platform.OS === 'ios' ? 'audio/wav' : 'audio/m4a';
      const filePath = `${STORAGE_PATH_PREFIX}${meetingId}.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = base64ToArrayBuffer(base64);

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, arrayBuffer, {
          contentType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Generate a signed URL valid for 7 days
      const { data: signedData, error: signError } =
        await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(filePath, SIGNED_URL_TTL);

      if (signError || !signedData?.signedUrl) {
        throw signError ?? new Error('Failed to get signed URL.');
      }

      // Notify backend to process the meeting
      const response = await fetch(`${apiUrl}/process-meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: signedData.signedUrl,
          meeting_id: meetingId,
          push_token: pushToken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
      }

      recordingRef.current = null;
      setState('idle');
    } catch (err) {
      if (Platform.OS === 'android') {
        RecordingServiceModule?.stop();
      }
      KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);
      setError('Failed to upload or process recording.');
      recordingRef.current = null;
      setState('idle');
    }
  }, []);

  // Keep ref updated so the NativeEventEmitter stop_requested handler can call it
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  return { state, error, elapsed, startRecording, pauseRecording, resumeRecording, stopRecording };
}