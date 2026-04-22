import 'react-native-url-polyfill/auto';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications } from '../lib/notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Register device for push notifications on mount
    registerForPushNotifications();

    // Cold start: app was killed, user tapped notification to open app
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const meetingId =
        response.notification.request.content.data?.meeting_id as
          | string
          | undefined;
      if (meetingId) {
        // Delay to let the navigator mount first
        setTimeout(() => router.push(`/meeting/${meetingId}`), 300);
      }
    });

    // Foreground/background: user taps notification while app is open
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const meetingId =
          response.notification.request.content.data?.meeting_id as
            | string
            | undefined;
        if (meetingId) {
          router.push(`/meeting/${meetingId}`);
        }
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="meeting/[id]"
        options={{ title: 'Meeting Detail', headerBackTitle: 'Back' }}
      />
      <Stack.Screen name="liveactivity" options={{ headerShown: false, animation: 'none' }} />
    </Stack>
  );
}
