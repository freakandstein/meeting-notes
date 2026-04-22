import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Meeting } from '../types';

const STORAGE_KEY = 'cached_meetings';

export async function saveMeetingsToCache(meetings: Meeting[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
}

export async function loadMeetingsFromCache(): Promise<Meeting[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as Meeting[];
}

export async function upsertMeetingInCache(meeting: Meeting): Promise<void> {
  const cached = await loadMeetingsFromCache();
  const idx = cached.findIndex((m) => m.id === meeting.id);
  if (idx >= 0) {
    cached[idx] = meeting;
  } else {
    cached.unshift(meeting);
  }
  // Keep sorted by created_at descending
  cached.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  await saveMeetingsToCache(cached);
}
