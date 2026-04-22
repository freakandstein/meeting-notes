/**
 * Supabase timestamps may lack a 'Z' suffix — ensure they're parsed as UTC.
 */
export function parseSupabaseDate(ts: string): Date {
  return new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z');
}

/**
 * Formats a duration in seconds to MM:SS.
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
