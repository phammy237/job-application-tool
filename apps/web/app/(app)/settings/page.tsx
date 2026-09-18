import {
  getOwnEmailConnection,
  isFeatureEnabled,
  listOwnApplications,
  listOwnEmailSignalsNeedingConfirmation,
  listOwnExtensionSessions,
} from '@career-os/database';
import { FEATURE_FLAG_KEYS } from '@career-os/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { formatFriendlyDateTime } from '../../../lib/format-friendly-date';
import { createClient } from '../../../lib/supabase/server';
import { DeleteAccountButton } from './delete-account-button';
import { GmailSection } from './gmail-section';
import { RevokeExtensionSessionButton } from './revoke-extension-session-button';

const GMAIL_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'That connection attempt could not be verified — please try again.',
  session_expired: 'Your session expired before the connection finished — please try again.',
  not_enabled: 'Gmail sync is not enabled for this account.',
  connect_failed: 'Could not connect Gmail — please try again.',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_error?: string; gmail_connected?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const extensionSessions = await listOwnExtensionSessions(supabase, user.id);
  const { gmail_error: gmailError, gmail_connected: gmailConnected } = await searchParams;

  const gmailGloballyEnabled = await isFeatureEnabled(
    supabase,
    FEATURE_FLAG_KEYS.GMAIL_INTEGRATION_ENABLED,
  );
  const gmailConnection = gmailGloballyEnabled ? await getOwnEmailConnection(supabase, user.id) : null;
  const [pendingSignals, applications] = gmailConnection
    ? await Promise.all([
        listOwnEmailSignalsNeedingConfirmation(supabase, user.id),
        listOwnApplications(supabase, user.id),
      ])
    : [[], []];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Account and privacy controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected devices</CardTitle>
          <CardDescription>
            Chrome extension sessions. Each one can analyze job pages on your behalf —
            revoke any you don&apos;t recognize.{' '}
            <Link href="/extension-connect" className="underline underline-offset-2">
              Connect a new device
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {extensionSessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No extension connected yet.</p>
          ) : (
            <div className="space-y-3">
              {extensionSessions.map((session) => (
                <div
                  key={session.id}
                  className="border-border bg-card flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {session.deviceLabel ?? 'Unnamed device'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {session.lastUsedAt
                        ? `Last used ${formatFriendlyDateTime(session.lastUsedAt)}`
                        : 'Never used'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Connected {formatFriendlyDateTime(session.createdAt)} · Expires{' '}
                      {formatFriendlyDateTime(session.expiresAt)}
                    </p>
                  </div>
                  <RevokeExtensionSessionButton
                    id={session.id}
                    deviceLabel={session.deviceLabel}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resume &amp; Profile</CardTitle>
          <CardDescription>
            Already have a resume? Upload it and Career OS can extract your experience,
            education, projects, skills, and contact details for review — nothing is added to
            your profile until you approve it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/resume-import" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Import resume
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gmail</CardTitle>
          <CardDescription>
            {gmailGloballyEnabled
              ? 'Check your inbox for application status updates — manually, or automatically (throttled) while you have this page open. Always opt-in, never a background job.'
              : 'Not yet available for this account.'}
          </CardDescription>
        </CardHeader>
        {gmailGloballyEnabled ? (
          <CardContent>
            {gmailError ? (
              <p className="text-destructive mb-3 text-sm">
                {GMAIL_ERROR_MESSAGES[gmailError] ?? 'Something went wrong connecting Gmail.'}
              </p>
            ) : null}
            {gmailConnected ? (
              <p className="mb-3 text-sm text-green-600 dark:text-green-500">Gmail connected.</p>
            ) : null}
            <GmailSection
              connection={gmailConnection}
              pendingSignals={pendingSignals}
              applications={applications.map((app) => ({
                id: app.id,
                company: app.company,
                title: app.title,
              }))}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card className="border-destructive/40 mt-6 border-t-2 pt-1">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Deletes your profile, résumés, applications, and every other record. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountButton />
        </CardContent>
      </Card>
    </div>
  );
}
