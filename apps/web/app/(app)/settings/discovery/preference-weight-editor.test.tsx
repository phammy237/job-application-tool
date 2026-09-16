// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferenceWeightEditor } from './preference-weight-editor';

const OPTIONS = ['SOFTWARE_ENGINEERING', 'DATA_SCIENCE', 'PRODUCT_MANAGEMENT'];
const LABELS = {
  SOFTWARE_ENGINEERING: 'Software Engineering',
  DATA_SCIENCE: 'Data Science',
  PRODUCT_MANAGEMENT: 'Product Management',
};

afterEach(() => {
  cleanup();
});

describe('PreferenceWeightEditor', () => {
  it('shows an honest "nothing rated" state when the map is empty', () => {
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Nothing rated yet — treated as unknown.')).toBeInTheDocument();
  });

  it('renders each rated entry with its label and weight', () => {
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{ SOFTWARE_ENGINEERING: 8 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Software Engineering weight/i })).toHaveValue(8);
  });

  it('the "add" dropdown only offers options not already rated', () => {
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{ SOFTWARE_ENGINEERING: 8 }}
        onChange={vi.fn()}
      />,
    );
    const addSelect = screen.getByLabelText('Add a preference');
    const optionLabels = Array.from(addSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toEqual(['Data Science', 'Product Management']);
  });

  it('adding a preference sets it to a default weight of 5, never 0', () => {
    const onChange = vi.fn();
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{}}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Add a preference'), {
      target: { value: 'DATA_SCIENCE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith({ DATA_SCIENCE: 5 });
  });

  it('removing an entry deletes the key entirely (back to unknown), never sets it to 0', () => {
    const onChange = vi.fn();
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{ SOFTWARE_ENGINEERING: 8, DATA_SCIENCE: 3 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    const [nextValues] = onChange.mock.calls[0]!;
    expect(nextValues).toEqual({ DATA_SCIENCE: 3 });
    expect('SOFTWARE_ENGINEERING' in nextValues).toBe(false);
  });

  it('editing a rated weight clamps to [0, 10]', () => {
    const onChange = vi.fn();
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={OPTIONS}
        labels={LABELS}
        values={{ SOFTWARE_ENGINEERING: 5 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: /Software Engineering weight/i }), {
      target: { value: '20' },
    });
    expect(onChange).toHaveBeenCalledWith({ SOFTWARE_ENGINEERING: 10 });
  });

  it('hides the "add" control once every option has been rated', () => {
    render(
      <PreferenceWeightEditor
        legend="Role families"
        allOptions={['SOFTWARE_ENGINEERING']}
        labels={LABELS}
        values={{ SOFTWARE_ENGINEERING: 8 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Add a preference')).not.toBeInTheDocument();
  });
});
