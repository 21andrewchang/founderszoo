import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from './stubs/env-public';

export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: false,
		storage: localStorage
	}
});
