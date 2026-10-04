'use client';

import { Button } from '@career-os/ui';
import { type ReactNode, useRef, useState, useTransition } from 'react';
import type { ActionResult } from './action-result';

interface ActionFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
  size?: 'default' | 'sm';
  resetOnSuccess?: boolean;
  /** Ask for window.confirm before submitting (destructive actions). */
  confirmMessage?: string;
  className?: string;
}

/**
 * Generic client form wrapper for myOS server actions: useTransition pending state, an
 * aria-live region for the result, and no client-side imports of server-only packages.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Saving…',
  variant = 'default',
  size = 'sm',
  resetOnSuccess = false,
  confirmMessage,
  className,
}: ActionFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const res = await action(data);
            setResult(res);
            if (res.ok && resetOnSuccess) formRef.current?.reset();
          } catch {
            setResult({ ok: false, message: 'Something went wrong. Please try again.' });
          }
        });
      }}
    >
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="submit" size={size} variant={variant} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className={
            result && !result.ok
              ? 'text-destructive text-sm'
              : 'text-muted-foreground text-sm'
          }
        >
          {result?.message ?? ''}
        </p>
      </div>
    </form>
  );
}
