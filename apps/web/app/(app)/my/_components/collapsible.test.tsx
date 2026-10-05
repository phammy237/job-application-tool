// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
  readStoredOpen,
  writeStoredOpen,
} from './collapsible';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe('Collapsible', () => {
  it('toggles aria-expanded and hides content with a real button', () => {
    render(
      <Collapsible title="Evidence" count={3}>
        <p>inner content</p>
      </Collapsible>,
    );
    const button = screen.getByRole('button', { name: /evidence/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(button.getAttribute('aria-controls')!);
    expect(region).not.toBeNull();
    expect(region).not.toBeVisible();
    expect(screen.getByText('3')).toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(region).toBeVisible();
    expect(screen.getByText('inner content')).toBeVisible();
  });

  it('wraps the toggle in the requested heading level', () => {
    render(
      <Collapsible title="Skills" headingLevel={2} defaultOpen>
        x
      </Collapsible>,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: /skills/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skills/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps meta content outside the toggle button', () => {
    render(
      <Collapsible title="Row" meta={<a href="/x">Open</a>}>
        x
      </Collapsible>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(screen.getByRole('button', { name: /row/i })).not.toContainElement(link);
  });

  it('persists and restores the open state under storageKey', () => {
    const { unmount } = render(
      <Collapsible title="Persisted" storageKey="t:persist">
        x
      </Collapsible>,
    );
    fireEvent.click(screen.getByRole('button', { name: /persisted/i }));
    expect(readStoredOpen('t:persist')).toBe(true);
    unmount();
    render(
      <Collapsible title="Persisted" storageKey="t:persist">
        x
      </Collapsible>,
    );
    expect(screen.getByRole('button', { name: /persisted/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('still works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredOpen('k')).toBeNull();
    expect(() => writeStoredOpen('k', true)).not.toThrow();
    render(
      <Collapsible title="Robust" storageKey="t:robust">
        x
      </Collapsible>,
    );
    const button = screen.getByRole('button', { name: /robust/i });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens and closes every member of a group via Expand all / Collapse all', () => {
    render(
      <CollapsibleGroup>
        <CollapsibleGroupControls label="items" />
        <Collapsible title="One">a</Collapsible>
        <Collapsible title="Two" defaultOpen>
          b
        </Collapsible>
      </CollapsibleGroup>,
    );
    const one = screen.getByRole('button', { name: 'One' });
    const two = screen.getByRole('button', { name: 'Two' });
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }));
    expect(one).toHaveAttribute('aria-expanded', 'true');
    expect(two).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));
    expect(one).toHaveAttribute('aria-expanded', 'false');
    expect(two).toHaveAttribute('aria-expanded', 'false');
    // Repeating the same command still applies after a manual toggle.
    fireEvent.click(one);
    fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));
    expect(one).toHaveAttribute('aria-expanded', 'false');
  });
});
