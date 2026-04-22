import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

/**
 * Invisible screen that handles Live Activity deep links:
 *   meetingnotes://liveactivity?action=pause|resume|stop
 * Expo Router pushes this screen on top of the existing stack.
 * We emit the event then go BACK (not replace) so HomeScreen stays alive.
 */
export default function LiveActivityScreen() {
  const { action } = useLocalSearchParams<{ action: string }>();
  const router = useRouter();

  useEffect(() => {
    if (action) {
      DeviceEventEmitter.emit('liveActivityAction', { action });
    }
    // Go back to preserve HomeScreen state (recording ref, elapsed, etc.)
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [action]);

  return null;
}
