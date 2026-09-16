// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPreferenceEditor } from './location-preference-editor';

const TOKENS = ['NEW_YORK_NY', 'SAN_FRANCISCO_CA', 'REMOTE_UNITED_STATES'];

afterEach(() => {
  cleanup();
});

describe('LocationPreferenceEditor', () => {
  it('shows an honest "nothing rated" state when empty', () => {
    render(<LocationPreferenceEditor locationTokens={TOKENS} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText('No locations rated yet — treated as unknown.')).toBeInTheDocument();
  });

  it('renders a rated token with a human-readable label and its category', () => {
    render(
      <LocationPreferenceEditor
        locationTokens={TOKENS}
        values={{ NEW_YORK_NY: 'PREFERRED' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('New York NY')).toBeInTheDocument();
    expect(screen.getByLabelText('New York NY preference')).toHaveValue('PREFERRED');
  });

  it('explains that Exclude is a hard filter, not part of Match', () => {
    render(<LocationPreferenceEditor locationTokens={TOKENS} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/removes a matching job from your results completely/)).toBeInTheDocument();
  });

  it('adding a location defaults it to PREFERRED', () => {
    const onChange = vi.fn();
    render(<LocationPreferenceEditor locationTokens={TOKENS} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Add a location'), {
      target: { value: 'SAN_FRANCISCO_CA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith({ SAN_FRANCISCO_CA: 'PREFERRED' });
  });

  it('changing a rated location to EXCLUDE is reflected exactly', () => {
    const onChange = vi.fn();
    render(
      <LocationPreferenceEditor
        locationTokens={TOKENS}
        values={{ NEW_YORK_NY: 'PREFERRED' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('New York NY preference'), {
      target: { value: 'EXCLUDE' },
    });
    expect(onChange).toHaveBeenCalledWith({ NEW_YORK_NY: 'EXCLUDE' });
  });

  it('removing a rated location deletes the key entirely', () => {
    const onChange = vi.fn();
    render(
      <LocationPreferenceEditor
        locationTokens={TOKENS}
        values={{ NEW_YORK_NY: 'PREFERRED', SAN_FRANCISCO_CA: 'AVOID' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    const [nextValues] = onChange.mock.calls[0]!;
    expect('NEW_YORK_NY' in nextValues).toBe(false);
    expect(nextValues).toEqual({ SAN_FRANCISCO_CA: 'AVOID' });
  });
});
