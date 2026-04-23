import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useMeetings } from '../../hooks/useMeetings';
import { parseSupabaseDate } from '../../lib/dateUtils';
import { Colors } from '../../lib/constants';
import type { Meeting } from '../../types';

const STATUS_COLOR: Record<Meeting['status'], string> = {
  processing: Colors.processingBadge,
  completed: Colors.success,
  failed: Colors.danger,
};

export default function MeetingsScreen() {
  const router = useRouter();
  const { meetings, loading, refreshing, refresh, error } = useMeetings();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.trim().length >= 3) {
      debounceTimer.current = setTimeout(() => setDebouncedQuery(text), 300);
    } else {
      setDebouncedQuery('');
    }
  };

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  const filteredMeetings = debouncedQuery.trim()
    ? meetings.filter((m) => {
        const q = debouncedQuery.toLowerCase();
        return (
          m.summary?.toLowerCase().includes(q) ||
          m.transcript?.toLowerCase().includes(q)
        );
      })
    : meetings;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {(meetings.length > 0 || query.length > 0) && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search transcript or summary…"
            placeholderTextColor={Colors.faint}
            value={query}
            onChangeText={handleQueryChange}
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
      )}
      <FlatList
        data={filteredMeetings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.flexGrow,
          filteredMeetings.length === 0 ? styles.emptyContainer : styles.list,
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
            {debouncedQuery.trim()
              ? `No results for "${debouncedQuery}".`
              : query.trim().length > 0 && query.trim().length < 3
              ? 'Type at least 3 characters to search.'
              : 'No meetings yet.\nTap Record to start.'}
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
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  flexGrow: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyText: {
    color: Colors.faint,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 15,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.dark,
  },
  card: {
    backgroundColor: Colors.white,
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
    color: Colors.darkMid,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summary: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 19,
  },
  summaryPlaceholder: {
    fontSize: 13,
    color: Colors.faint,
    fontStyle: 'italic',
  },
});
