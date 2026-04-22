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
import { formatDuration } from '../../lib/dateUtils';
import { Colors } from '../../lib/constants';
import { useRecording } from '../../hooks/useRecording';

export default function HomeScreen() {
  const { state, error, elapsed, startRecording, pauseRecording, resumeRecording, stopRecording } =
    useRecording();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const meetingIdRef = useRef<string>('');

  useEffect(() => {
    registerForPushNotifications().then(setPushToken);
  }, []);

  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  const handleRecordPress = async () => {
    if (state === 'idle') {
      if (!pushToken) {
        Alert.alert(
          'Not Ready',
          'Push notifications are still registering. Please try again in a moment.'
        );
        return;
      }
      meetingIdRef.current = Crypto.randomUUID();
      await startRecording(meetingIdRef.current, pushToken);
    } else if (state === 'recording' || state === 'paused') {
      await stopRecording();
    }
  };

  const handlePauseResumePress = async () => {
    if (state === 'recording') {
      await pauseRecording();
    } else if (state === 'paused') {
      await resumeRecording();
    }
  };

  const isActive = state === 'recording' || state === 'paused';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Meeting Notes</Text>

      {isActive && (
        <Text style={[styles.timer, state === 'paused' && styles.timerPaused]}>
          {formatDuration(elapsed)}
        </Text>
      )}

      {state === 'uploading' && (
        <Text style={styles.status}>Uploading & processing…</Text>
      )}

      {/* Pause / Resume button — visible while recording or paused */}
      {isActive && (
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={handlePauseResumePress}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {state === 'recording' ? 'Pause' : 'Resume'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Start / Stop button */}
      <TouchableOpacity
        style={[
          styles.button,
          isActive && styles.buttonRecording,
          state === 'uploading' && styles.buttonDisabled,
        ]}
        onPress={handleRecordPress}
        disabled={state === 'uploading'}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {state === 'idle' && 'Start Recording'}
          {state === 'recording' && 'Stop Recording'}
          {state === 'paused' && 'Stop Recording'}
          {state === 'uploading' && 'Processing…'}
        </Text>
      </TouchableOpacity>

      {state === 'recording' && (
        <View style={styles.recordingIndicator}>
          <View style={styles.dot} />
          <Text style={styles.recordingText}>Recording in progress</Text>
        </View>
      )}

      {state === 'paused' && (
        <View style={styles.recordingIndicator}>
          <View style={[styles.dot, styles.dotPaused]} />
          <Text style={[styles.recordingText, styles.pausedText]}>Recording paused</Text>
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
    backgroundColor: Colors.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.dark,
    marginBottom: 48,
  },
  timer: {
    fontSize: 56,
    fontWeight: '200',
    // @ts-ignore — fontVariant is valid on iOS/Android
    fontVariant: ['tabular-nums'],
    color: Colors.danger,
    marginBottom: 32,
  },
  timerPaused: {
    color: Colors.warning,
  },
  status: {
    fontSize: 16,
    color: Colors.muted,
    marginBottom: 24,
  },
  button: {
    backgroundColor: Colors.primary,
    width: 240,
    paddingVertical: 20,
    borderRadius: 50,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    marginBottom: 16,
  },
  buttonSecondary: {
    backgroundColor: Colors.warning,
    shadowColor: Colors.warning,
  },
  buttonRecording: {
    backgroundColor: Colors.danger,
    shadowColor: Colors.danger,
  },
  buttonDisabled: {
    backgroundColor: Colors.faint,
    shadowColor: Colors.faint,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.danger,
  },
  dotPaused: {
    backgroundColor: Colors.warning,
  },
  recordingText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500',
  },
  pausedText: {
    color: Colors.warning,
  },
});
