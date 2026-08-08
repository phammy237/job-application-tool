import { listOwnExtensionSessions } from '@career-os/database';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { DeleteAccountButton } from './delete-account-button';
import { RevokeExtensionSessionButton } from './revoke-extension-session-button';

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const extensionSessions = await listOwnExtensionSessions(supabase, user.id);

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
                        ? `Last used ${new Date(session.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
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
          <CardTitle>Gmail</CardTitle>
          <CardDescription>
            Not yet available — Gmail sync ships in a later phase and will always be
            opt-in and manual. See docs/EMAIL_INTEGRATION.md.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-destructive/40">
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
