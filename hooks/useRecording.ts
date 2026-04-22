import { useCallback, useRef, useState } from 'react';
import {
  Audio,
  InterruptionModeAndroid,
  InterruptionModeIOS,
} from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as KeepAwake from 'expo-keep-awake';
import { NativeModules, Platform } from 'react-native';
import { supabase } from '../lib/supabase';

const { RecordingServiceModule } = NativeModules;

export type RecordingState = 'idle' | 'recording' | 'uploading';

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
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

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
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      await KeepAwake.activateKeepAwakeAsync('recording');
      setState('recording');
    } catch (err) {
      console.error('startRecording error:', err);
      setError('Failed to start recording.');
    }
  }, []);

  /**
   * Stops the recording, uploads the audio to Supabase Storage,
   * then calls the backend API to kick off processing.
   */
  const stopRecording = useCallback(
    async (meetingId: string, pushToken: string): Promise<void> => {
      const recording = recordingRef.current;
      if (!recording) return;

      try {
        setState('uploading');

        await recording.stopAndUnloadAsync();

        // Stop native foreground service
        if (Platform.OS === 'android') {
          RecordingServiceModule?.stop();
        }
        // Release wake lock after recording stops
        KeepAwake.deactivateKeepAwake('recording');

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
        const filePath = `meetings/${meetingId}.${ext}`;
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const arrayBuffer = base64ToArrayBuffer(base64);

        const { error: uploadError } = await supabase.storage
          .from('audio_meeting_notes')
          .upload(filePath, arrayBuffer, {
            contentType,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Generate a signed URL valid for 7 days
        const { data: signedData, error: signError } =
          await supabase.storage
            .from('audio_meeting_notes')
            .createSignedUrl(filePath, 60 * 60 * 24 * 7);

        if (signError || !signedData?.signedUrl) {
          throw signError ?? new Error('Failed to get signed URL.');
        }

        // Notify backend to process the meeting
        const apiUrl = process.env.EXPO_PUBLIC_API_URL as string;
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
        console.error('stopRecording error:', err);
        if (Platform.OS === 'android') {
          RecordingServiceModule?.stop();
        }
        KeepAwake.deactivateKeepAwake('recording');
        setError('Failed to upload or process recording.');
        recordingRef.current = null;
        setState('idle');
      }
    },
    []
  );

  return { state, error, startRecording, stopRecording };
}
