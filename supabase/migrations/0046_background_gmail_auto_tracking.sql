-- Career OS — background Gmail auto-tracking (explicit, separate opt-in on top of manual sync).
--
-- Deliberately NOT the same toggle as `user_settings.gmail_integration_enabled` (which connecting
-- Gmail already sets true) — connecting Gmail only ever enabled manual "Sync Gmail" clicks (and
-- the existing throttled auto-check while /settings is open) per docs/USER_FLOWS.md §7/§9's
-- "never scheduled, background, or unattended" posture. This migration adds a second, narrower
-- toggle a user must separately opt into before a scheduled cron job (apps/web's
-- /api/cron/gmail-background-sync) is allowed to touch their inbox without them having the app
-- open at all. A user who only wants manual control keeps that by simply never flipping this on.
--
-- `background_gmail_tracking_enabled` follows the exact same column-privilege pattern 0044
-- established for `gmail_integration_enabled`/`theme` — authenticated may update only this one
-- additional column, nothing else.
alter table public.user_settings
  add column background_gmail_tracking_enabled boolean not null default false;

grant update (background_gmail_tracking_enabled) on public.user_settings to authenticated;

-- `applications.auto_tracked` — permanent provenance, never cleared: this application was never
-- built through the normal Analyze Job / Save Application flow, so its company/title came from
-- best-effort deterministic parsing of a Gmail confirmation message, never a real job posting.
-- The UI must surface this plainly (docs/USER_FLOWS.md update), not hide it. Defaults false for
-- every existing/ordinary application; only the new service-role-only creation path
-- (createAutoTrackedApplicationFromEmail) ever sets it true.
alter table public.applications
  add column auto_tracked boolean not null default false;

-- email_signals.confirmation_status (migration 0012) gains 'AUTO_CREATED' — distinct from
-- 'AUTO_APPLIED' (which means an *existing* tracked application's status changed) because this
-- message instead caused a brand-new application to appear with no prior user action at all; the
-- signal history and the pending-confirmation UI must be able to tell those two apart, not
-- conflate "we updated something you already knew about" with "a new row just appeared."
alter table public.email_signals drop constraint email_signals_confirmation_status_check;
alter table public.email_signals add constraint email_signals_confirmation_status_check
  check (confirmation_status in (
    'PENDING', 'CONFIRMED', 'DECLINED', 'AUTO_APPLIED', 'AUTO_CREATED', 'NOT_APPLICABLE'
  ));
