import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { loadMeetingsFromCache, upsertMeetingInCache } from '../../lib/meetingStorage';
import type { Meeting } from '../../types';

// Supabase timestamps may lack 'Z' suffix — ensure they're parsed as UTC
function parseSupabaseDate(ts: string): Date {
  return new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z');
}

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    // Load from cache first for instant display
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

    // Fetch from network and update cache
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3182ce" />
      </View>
    );
  }

  if (!meeting) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>Meeting not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.timestamp}>
        {parseSupabaseDate(meeting.created_at).toLocaleString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>

      {/* Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <Text style={styles.body}>
          {meeting.summary ?? 'Summary not available yet.'}
        </Text>
      </View>

      {/* Transcript */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transcript</Text>
        <Text style={styles.body}>
          {meeting.transcript ?? 'Transcript not available yet.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFound: {
    fontSize: 15,
    color: '#718096',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  timestamp: {
    fontSize: 13,
    color: '#a0aec0',
    marginBottom: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a202c',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
  },
  body: {
    fontSize: 15,
    color: '#4a5568',
    lineHeight: 26,
  },
});
