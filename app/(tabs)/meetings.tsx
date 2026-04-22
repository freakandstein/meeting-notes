import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMeetings } from '../../hooks/useMeetings';
import { parseSupabaseDate } from '../../lib/dateUtils';
import type { Meeting } from '../../types';

const STATUS_COLOR: Record<Meeting['status'], string> = {
  processing: '#d69e2e',
  completed: '#38a169',
  failed: '#e53e3e',
};

export default function MeetingsScreen() {
  const router = useRouter();
  const { meetings, loading, refreshing, refresh } = useMeetings();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3182ce" />
      </View>
    );
  }

  return (
    <FlatList
      data={meetings}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        { flexGrow: 1 },
        meetings.length === 0 ? styles.emptyContainer : styles.list,
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
        />
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No meetings yet.{'\n'}Tap Record to start.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[
            styles.card,
            item.status !== 'completed' && styles.cardDisabled,
          ]}
          onPress={() => router.push(`/meeting/${item.id}`)}
          disabled={item.status !== 'completed'}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.date}>
              {parseSupabaseDate(item.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: STATUS_COLOR[item.status] },
              ]}
            >
              <Text style={styles.badgeText}>{item.status}</Text>
            </View>
          </View>

          {item.summary ? (
            <Text style={styles.summary} numberOfLines={2}>
              {item.summary}
            </Text>
          ) : (
            <Text style={styles.summaryPlaceholder}>
              {item.status === 'processing'
                ? 'Processing audio…'
                : item.status === 'failed'
                ? 'Processing failed.'
                : ''}
            </Text>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyText: {
    color: '#a0aec0',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardDisabled: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  date: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2d3748',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summary: {
    fontSize: 13,
    color: '#718096',
    lineHeight: 19,
  },
  summaryPlaceholder: {
    fontSize: 13,
    color: '#a0aec0',
    fontStyle: 'italic',
  },
});
