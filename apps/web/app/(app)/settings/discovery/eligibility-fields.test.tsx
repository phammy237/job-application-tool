// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EligibilityBooleanField, GraduationYearField } from './eligibility-fields';

afterEach(() => {
  cleanup();
});

describe('EligibilityBooleanField', () => {
  it('renders "Unknown" selected for a null value — never defaults to No', () => {
    render(
      <EligibilityBooleanField label="US citizen" description="d" value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('US citizen')).toHaveValue('');
  });

  it('renders Yes/No correctly for true/false', () => {
    render(
      <EligibilityBooleanField label="US citizen" description="d" value={true} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('US citizen')).toHaveValue('true');
    cleanup();
    render(
      <EligibilityBooleanField label="US citizen" description="d" value={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('US citizen')).toHaveValue('false');
  });

  it('selecting each option calls onChange with the exact tri-state value', () => {
    const onChange = vi.fn();
    render(
      <EligibilityBooleanField label="US citizen" description="d" value={null} onChange={onChange} />,
    );
    const select = screen.getByLabelText('US citizen');
    fireEvent.change(select, { target: { value: 'true' } });
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(select, { target: { value: 'false' } });
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('GraduationYearField', () => {
  it('renders empty for null (never forces a value)', () => {
    render(<GraduationYearField value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Graduation year')).toHaveValue(null);
  });

  it('renders the numeric value when set', () => {
    render(<GraduationYearField value={2026} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Graduation year')).toHaveValue(2026);
  });

  it('clearing the field calls onChange with null', () => {
    const onChange = vi.fn();
    render(<GraduationYearField value={2026} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Graduation year'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('typing a year calls onChange with the parsed number', () => {
    const onChange = vi.fn();
    render(<GraduationYearField value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Graduation year'), { target: { value: '2028' } });
    expect(onChange).toHaveBeenCalledWith(2028);
  });
});
