'use client';

import { useActionState, useState } from 'react';
import { Button, Input } from '@career-os/ui';
import {
  rotatePortfolioApiKey,
  savePortfolioSettings,
  type RotateKeyState,
  type SaveSettingsState,
} from './actions';

export function PortfolioSettingsForm({
  enabled,
  displayName,
  headline,
}: {
  enabled: boolean;
  displayName: string;
  headline: string;
}) {
  const [state, action, pending] = useActionState<SaveSettingsState, FormData>(
    savePortfolioSettings,
    {},
  );
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <div className="flex items-start gap-3">
        <input
          id="portfolio-enabled"
          name="enabled"
          type="checkbox"
          defaultChecked={enabled}
          className="accent-primary mt-1 h-5 w-5"
          aria-describedby="portfolio-enabled-help"
        />
        <div>
          <label htmlFor="portfolio-enabled" className="text-sm font-medium">
            Enable portfolio export
          </label>
          <p id="portfolio-enabled-help" className="text-muted-foreground text-sm">
            Off by default. While off, the API returns nothing, even with a valid key.
          </p>
        </div>
      </div>
      <div>
        <label htmlFor="portfolio-name" className="text-sm font-medium">
          Display name
        </label>
        <Input
          id="portfolio-name"
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          autoComplete="off"
        />
      </div>
      <div>
        <label htmlFor="portfolio-headline" className="text-sm font-medium">
          Headline
        </label>
        <Input
          id="portfolio-headline"
          name="headline"
          defaultValue={headline}
          maxLength={160}
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        <p role="status" aria-live="polite" className="text-sm">
          {state.ok && <span className="text-muted-foreground">Saved.</span>}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </p>
      </div>
    </form>
  );
}

export function ApiKeyPanel({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState<RotateKeyState, FormData>(
    (prev) => rotatePortfolioApiKey(prev),
    {},
  );
  const [copied, setCopied] = useState(false);

  const copy = async (key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3">
      {state.key ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-3"
        >
          <p className="text-sm font-medium">
            Copy your API key now. It will not be shown again.
          </p>
          <p className="text-muted-foreground text-xs">
            Only a one-way hash is stored, so it cannot be recovered. If you lose it,
            rotate to get a new one. Keep it on your website&apos;s server; never put it
            in browser code.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code
              className="bg-background block flex-1 select-all break-all rounded border p-2 text-xs"
              data-testid="portfolio-api-key"
            >
              {state.key}
            </code>
            <Button type="button" variant="outline" onClick={() => copy(state.key!)}>
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm">
          {hasKey ? (
            <>
              <span className="font-medium">A key exists.</span>{' '}
              <span className="text-muted-foreground">
                Its value is hidden. Rotating creates a new key and immediately stops the
                old one working.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              No key yet. Generate one to let your website read the export.
            </span>
          )}
        </p>
      )}
      <form
        action={action}
        onSubmit={(event) => {
          if (
            (hasKey || state.key) &&
            !window.confirm(
              'Rotate the API key? The current key stops working immediately and your website must be updated with the new one.',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <Button
          type="submit"
          variant={hasKey || state.key ? 'outline' : 'default'}
          disabled={pending}
        >
          {pending ? 'Working…' : hasKey || state.key ? 'Rotate key' : 'Generate key'}
        </Button>
        {state.error && (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
