// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CriterionRow } from './criterion-row';

afterEach(() => {
  cleanup();
});

describe('CriterionRow', () => {
  it('shows the checkbox as checked and the weight visible when weight > 0', () => {
    render(<CriterionRow label="Role fit" description="desc" weight={8} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Role fit' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /Role fit weight/i })).toHaveValue(8);
  });

  it('shows the checkbox as unchecked when weight is 0 (disabled), distinct from a low nonzero weight', () => {
    render(<CriterionRow label="Role fit" description="desc" weight={0} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Role fit' })).not.toBeChecked();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    cleanup();
    render(<CriterionRow label="Role fit" description="desc" weight={1} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Role fit' })).toBeChecked();
    expect(screen.getByText('Weight (0-10)')).toBeInTheDocument();
  });

  it('unchecking the checkbox sets weight to exactly 0', () => {
    const onChange = vi.fn();
    render(<CriterionRow label="Role fit" description="desc" weight={7} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Role fit' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('checking a disabled (weight 0) criterion sets a sensible nonzero default', () => {
    const onChange = vi.fn();
    render(<CriterionRow label="Role fit" description="desc" weight={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Role fit' }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('typing a weight directly clamps to [0, 10]', () => {
    const onChange = vi.fn();
    render(<CriterionRow label="Role fit" description="desc" weight={5} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: /Role fit weight/i });
    fireEvent.change(input, { target: { value: '99' } });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('renders extra content (e.g. the competency profile link) when provided', () => {
    render(
      <CriterionRow
        label="Skills"
        description="desc"
        weight={5}
        onChange={vi.fn()}
        extra={<p>Update your approved profile</p>}
      />,
    );
    expect(screen.getByText('Update your approved profile')).toBeInTheDocument();
  });
});
