export type Meeting = {
  id: string;
  user_id: string | null;
  audio_url: string;
  trasncript: string | null; // note: intentional typo matching Supabase column name
  summary: string | null;
  status: 'processing' | 'completed' | 'failed';
  push_token: string | null;
  created_at: string;
};
