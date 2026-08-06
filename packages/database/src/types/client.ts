import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** The only client type every query function in this package accepts. */
export type CareerOsSupabaseClient = SupabaseClient<Database>;
