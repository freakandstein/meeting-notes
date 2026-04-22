export type Meeting = {
  id: string;
  user_id: string | null;
  audio_url: string;
  transcript: string | null;
  summary: string | null;
  status: 'processing' | 'completed' | 'failed';
  push_token: string | null;
  created_at: string;
};
