import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMeeting } from '../../hooks/useMeeting';
import { parseSupabaseDate } from '../../lib/dateUtils';
import { Colors } from '../../lib/constants';

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { meeting, loading } = useMeeting(id);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
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
    color: Colors.muted,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  timestamp: {
    fontSize: 13,
    color: Colors.faint,
    marginBottom: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 8,
  },
  body: {
    fontSize: 15,
    color: Colors.textMid,
    lineHeight: 26,
  },
});
