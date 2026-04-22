import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { registerForPushNotifications } from '../../lib/notifications';
import { useRecording } from '../../hooks/useRecording';

export default function HomeScreen() {
  const { state, error, startRecording, stopRecording } = useRecording();
  const [elapsed, setElapsed] = useState(0);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch Expo push token once on mount
  useEffect(() => {
    registerForPushNotifications().then(setPushToken);
  }, []);

  // Keep a running timer while recording
  useEffect(() => {
    if (state === 'recording') {
      intervalRef.current = setInterval(
        () => setElapsed((s) => s + 1),
        1000
      );
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  // Surface errors to the user
  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  const handlePress = async () => {
    if (state === 'idle') {
      await startRecording();
    } else if (state === 'recording') {
      const meetingId = Crypto.randomUUID();
      await stopRecording(meetingId, pushToken ?? '');
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Meeting Notes</Text>

      {state === 'recording' && (
        <Text style={styles.timer}>{formatTime(elapsed)}</Text>
      )}

      {state === 'uploading' && (
        <Text style={styles.status}>Uploading & processing…</Text>
      )}

      <TouchableOpacity
        style={[
          styles.button,
          state === 'recording' && styles.buttonRecording,
          state === 'uploading' && styles.buttonDisabled,
        ]}
        onPress={handlePress}
        disabled={state === 'uploading'}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {state === 'idle' && 'Start Recording'}
          {state === 'recording' && 'Stop Recording'}
          {state === 'uploading' && 'Processing…'}
        </Text>
      </TouchableOpacity>

      {state === 'recording' && (
        <View style={styles.recordingIndicator}>
          <View style={styles.dot} />
          <Text style={styles.recordingText}>Recording in progress</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7fafc',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a202c',
    marginBottom: 48,
  },
  timer: {
    fontSize: 56,
    fontWeight: '200',
    // @ts-ignore — fontVariant is valid on iOS/Android
    fontVariant: ['tabular-nums'],
    color: '#e53e3e',
    marginBottom: 32,
  },
  status: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#3182ce',
    paddingHorizontal: 48,
    paddingVertical: 20,
    borderRadius: 50,
    shadowColor: '#3182ce',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  buttonRecording: {
    backgroundColor: '#e53e3e',
    shadowColor: '#e53e3e',
  },
  buttonDisabled: {
    backgroundColor: '#a0aec0',
    shadowColor: '#a0aec0',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    marginTop: 28,
    fontSize: 13,
    color: '#a0aec0',
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e53e3e',
  },
  recordingText: {
    fontSize: 13,
    color: '#e53e3e',
    fontWeight: '500',
  },
});
