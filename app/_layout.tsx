import 'react-native-url-polyfill/auto';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications } from '../lib/notifications';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Register device for push notifications on mount
    registerForPushNotifications();

    // Deep link: when user taps a push notification, navigate to the meeting
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

    return () => subscription.remove();
  }, []);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="meeting/[id]"
        options={{ title: 'Meeting Detail', headerBackTitle: 'Back' }}
      />
    </Stack>
  );
}
