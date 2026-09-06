import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase ist nicht konfiguriert: VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen. ' +
      'Siehe .env.example.',
  );
}

// Einziger Client für die gesamte App (Singleton), damit Auth-Session und
// Realtime-Verbindung nicht mehrfach aufgebaut werden.
export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
