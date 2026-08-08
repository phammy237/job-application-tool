'use client';

import { Button } from '@career-os/ui';
import { useState } from 'react';

type Status = 'idle' | 'minting' | 'handshaking' | 'connected' | 'error';

/**
 * chrome.runtime is only defined inside a page that a real installed extension has whitelisted
 * via its manifest's `externally_connectable.matches` — every other visitor (no extension
 * installed, a different browser entirely) simply doesn't have this global. Read via a local
 * cast rather than a `declare global` Window augmentation: apps/extension's @types/chrome
 * already declares its own global `chrome`, hoisted into the shared node_modules/@types that
 * this workspace's tsc also sees by default, so augmenting the same global here collides with
 * it (two conflicting shapes for the same declaration).
 */
interface MinimalChromeRuntime {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

function getChromeRuntime(): MinimalChromeRuntime | undefined {
  return (window as unknown as { chrome?: { runtime?: MinimalChromeRuntime } }).chrome?.runtime;
}

export function ConnectExtensionButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setStatus('minting');
    setError(null);

    try {
      const res = await fetch('/api/auth/extension-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceLabel: guessDeviceLabel() }),
      });
      if (!res.ok) {
        throw new Error('Could not create a connection token. Try logging in again.');
      }
      const minted = (await res.json()) as { token: string; expiresAt: string };

      const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;
      const chromeRuntime = getChromeRuntime();
      if (!extensionId || !chromeRuntime?.sendMessage) {
        // No extension context available (not installed, or a non-Chrome browser). The token
        // was still minted server-side — nothing to hand it to yet, so surface that plainly
        // rather than pretending the connection succeeded.
        setStatus('error');
        setError(
          'Install the Career OS extension first, then come back to this page and try again.',
        );
        return;
      }

      setStatus('handshaking');
      chromeRuntime.sendMessage(
        extensionId,
        { type: 'CAREER_OS_EXTENSION_TOKEN', token: minted.token, expiresAt: minted.expiresAt },
        () => {
          if (chromeRuntime.lastError) {
            setStatus('error');
            setError('Could not reach the extension. Make sure it is installed and enabled.');
            return;
          }
          setStatus('connected');
        },
      );
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => void handleConnect()} disabled={status === 'minting' || status === 'handshaking'}>
        {status === 'minting' || status === 'handshaking' ? 'Connecting…' : 'Connect Extension'}
      </Button>
      {status === 'connected' ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Connected — you can close this tab and use the extension icon on any job page.
        </p>
      ) : null}
      {status === 'error' && error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : null}
    </div>
  );
}

function guessDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Chrome/')
      ? 'Chrome'
      : 'Browser';
  const os = ua.includes('Mac')
    ? 'macOS'
    : ua.includes('Windows')
      ? 'Windows'
      : ua.includes('Linux')
        ? 'Linux'
        : 'Unknown OS';
  return `${browser} on ${os}`;
}
