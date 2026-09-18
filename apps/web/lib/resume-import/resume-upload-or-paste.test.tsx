// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PASTE_TEXT_LENGTH, MIN_PASTE_TEXT_LENGTH, ResumeUploadOrPaste } from './resume-upload-or-paste';

afterEach(cleanup);

function pdfFile(name = 'resume.pdf', size = 1000): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

describe('ResumeUploadOrPaste', () => {
  it('1. renders both the Upload resume and Paste resume text entry points', () => {
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Upload resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste resume text' })).toBeInTheDocument();
  });

  it('2. upload mode: selecting a valid PDF shows the filename and Analyze calls onAnalyze with the file', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    const file = pdfFile('my-resume.pdf');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/my-resume\.pdf/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(onAnalyze).toHaveBeenCalledWith({ kind: 'file', file });
  });

  it('5. an unsupported file type is rejected client-side, never reaching onAnalyze', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    const file = new File(['x'], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/only pdf résumés are supported/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('3. paste mode: shows a textarea with a character count and calls onAnalyze with trimmed text', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste resume text' }));
    const textarea = screen.getByPlaceholderText('Paste the text from your resume here.');
    const longText = 'Jane Doe\nSoftware Engineer\n'.repeat(10); // well over MIN_PASTE_TEXT_LENGTH
    fireEvent.change(textarea, { target: { value: longText } });

    expect(screen.getByText(`${longText.length.toLocaleString()} characters`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(onAnalyze).toHaveBeenCalledWith({ kind: 'text', text: longText.trim() });
  });

  it('4a. empty pasted text is rejected, never reaching onAnalyze', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste resume text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(screen.getByText(/please paste your résumé text first/i)).toBeInTheDocument();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('4b. too-short pasted text is rejected with a distinct message, never reaching onAnalyze', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste resume text' }));
    const textarea = screen.getByPlaceholderText('Paste the text from your resume here.');
    fireEvent.change(textarea, { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(screen.getByText(new RegExp(`at least ${MIN_PASTE_TEXT_LENGTH} characters`, 'i'))).toBeInTheDocument();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('rejects pasted text over the max length, never reaching onAnalyze', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={false} errorMessage={null} onAnalyze={onAnalyze} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste resume text' }));
    const textarea = screen.getByPlaceholderText('Paste the text from your resume here.');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(MAX_PASTE_TEXT_LENGTH + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(screen.getByText(/too long/i)).toBeInTheDocument();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('duplicate Analyze click is guarded — the button is disabled while analyzing', () => {
    const onAnalyze = vi.fn();
    render(<ResumeUploadOrPaste analyzing={true} errorMessage={null} onAnalyze={onAnalyze} />);
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();
  });
});
