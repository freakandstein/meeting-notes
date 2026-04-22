import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { loadMeetingsFromCache, saveMeetingsToCache } from '../lib/meetingStorage';
import { getCachedPushToken } from '../lib/notifications';
import type { Meeting } from '../types';

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMeetings = useCallback(async () => {
    const pushToken = await getCachedPushToken();
    if (!pushToken) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('push_token', pushToken)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('fetchMeetings error:', JSON.stringify(error));
    }
    if (!error && data) {
      const fetched = data as Meeting[];
      setMeetings(fetched);
      await saveMeetingsToCache(fetched);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Show cache immediately, then refresh from network
  useEffect(() => {
    loadMeetingsFromCache().then((cached) => {
      if (cached.length > 0) {
        setMeetings(cached);
        setLoading(false);
      }
    });
    fetchMeetings();
  }, [fetchMeetings]);

  // Refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchMeetings();
    }, [fetchMeetings])
  );

  // Auto-refresh when a push notification arrives (foreground)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      fetchMeetings();
    });
    return () => sub.remove();
  }, [fetchMeetings]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchMeetings();
  }, [fetchMeetings]);

  return { meetings, loading, refreshing, refresh };
}
