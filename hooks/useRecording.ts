import { useCallback, useRef, useState } from 'react';
import {
  Audio,
  InterruptionModeAndroid,
  InterruptionModeIOS,
} from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

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

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
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
        const filePath = `meetings/${meetingId}.m4a`;
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const arrayBuffer = base64ToArrayBuffer(base64);

        const { error: uploadError } = await supabase.storage
          .from('audio_meeting_notes')
          .upload(filePath, arrayBuffer, {
            contentType: 'audio/m4a',
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
        setError('Failed to upload or process recording.');
        recordingRef.current = null;
        setState('idle');
      }
    },
    []
  );

  return { state, error, startRecording, stopRecording };
}
