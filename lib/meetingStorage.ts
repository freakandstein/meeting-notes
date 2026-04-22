import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSupabaseDate } from './dateUtils';
import type { Meeting } from '../types';

const STORAGE_KEY = 'cached_meetings';

export async function saveMeetingsToCache(meetings: Meeting[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
  } catch {
    // Cache is best-effort; silently ignore storage failures.
  }
}

export async function loadMeetingsFromCache(): Promise<Meeting[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Meeting[];
  } catch {
    // Corrupted or unavailable cache — return empty so the app falls back to network.
    return [];
  }
}

export async function upsertMeetingInCache(meeting: Meeting): Promise<void> {
  const cached = await loadMeetingsFromCache();
  const idx = cached.findIndex((m) => m.id === meeting.id);
  if (idx >= 0) {
    cached[idx] = meeting;
  } else {
    cached.unshift(meeting);
  }
  // Keep sorted by created_at descending (use parseSupabaseDate to handle missing 'Z' suffix)
  cached.sort(
    (a, b) =>
      parseSupabaseDate(b.created_at).getTime() - parseSupabaseDate(a.created_at).getTime()
  );
  await saveMeetingsToCache(cached);
}
