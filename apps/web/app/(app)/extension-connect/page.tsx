import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@career-os/ui';
import { requireUser } from '../../../lib/auth';
import { ConnectExtensionButton } from './connect-extension-button';

/**
 * The one-time token handoff page (docs/EXTENSION_DESIGN.md §4). requireUser()-gated — a real
 * page, so redirect-to-login on an unauthenticated visit is the correct behavior (unlike the
 * API routes, which must return 401 JSON instead).
 *
 * The mint only happens on an explicit "Connect Extension" click, not on page load, so opening
 * this page repeatedly doesn't silently mint a fresh token each time.
 */
export default async function ExtensionConnectPage() {
  await requireUser();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect the extension</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Link the Career OS Chrome extension to this account so it can analyze job pages
          on your behalf.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect Extension</CardTitle>
          <CardDescription>
            Install the extension from the Chrome Web Store first if you haven&apos;t
            already, then click below. Manage connected devices from{' '}
            <a href="/settings" className="underline underline-offset-2">
              Settings
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectExtensionButton />
        </CardContent>
      </Card>
    </div>
  );
}
