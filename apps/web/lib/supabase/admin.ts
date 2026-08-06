import 'server-only';
import { createSupabaseAdminClient } from '@career-os/database';

/**
 * Service-role client — bypasses RLS. Per CLAUDE.md, reserved for privileged operations
 * (currently: full account deletion, which must remove the auth.users row itself). Every
 * call site using this MUST independently verify and filter by the authenticated user_id
 * before touching a row. The `server-only` import makes accidentally pulling this into a
 * client bundle a build-time error rather than a runtime leak.
 */
export const createAdminClient = createSupabaseAdminClient;
