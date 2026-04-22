import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';
import { supabase } from '../lib/supabase';
import { loadMeetingsFromCache, upsertMeetingInCache } from '../lib/meetingStorage';
import { parseSupabaseDate } from '../lib/dateUtils';
import type { Meeting } from '../types';

export function useMeeting(id: string | undefined) {
  const navigation = useNavigation();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    // Show cached data instantly
    loadMeetingsFromCache().then((cached) => {
      const found = cached.find((m) => m.id === id);
      if (found) {
        setMeeting(found);
        setLoading(false);
        navigation.setOptions({
          title: parseSupabaseDate(found.created_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
        });
      }
    });

    // Fetch latest from network and update cache
    supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) {
          const m = data as Meeting;
          setMeeting(m);
          upsertMeetingInCache(m);
          navigation.setOptions({
            title: parseSupabaseDate(m.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
          });
        }
        setLoading(false);
      });
  }, [id]);

  return { meeting, loading };
}
