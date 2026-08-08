import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { detectFields } from './detect-fields';

const FORM_HTML = `
  <form>
    <label for="full_name">Full Name</label>
    <input id="full_name" name="full_name" type="text" />

    <label for="password">Password</label>
    <input id="password" name="password" type="password" />

    <input type="hidden" name="csrf_token" value="abc123" />
    <input type="submit" value="Apply" />

    <label for="resume">Resume</label>
    <input id="resume" name="resume" type="file" />

    <h2>Additional questions</h2>
    <label for="work_auth">Are you legally authorized to work in the United States?</label>
    <select id="work_auth" name="work_auth">
      <option>Yes</option>
      <option>No</option>
    </select>
  </form>
`;

function loadForm(): Document {
  return new JSDOM(FORM_HTML).window.document;
}

describe('detectFields', () => {
  it('never returns a field for a password input — excluded at detection time, not classified', () => {
    const fields = detectFields(loadForm());
    expect(fields.some((f) => f.htmlName === 'password')).toBe(false);
    expect(fields.some((f) => f.classification === 'AUTHENTICATION')).toBe(false);
  });

  it('excludes non-data controls (hidden, submit)', () => {
    const fields = detectFields(loadForm());
    expect(fields.some((f) => f.htmlName === 'csrf_token')).toBe(false);
    expect(fields.some((f) => f.inputType === 'submit')).toBe(false);
  });

  it('detects and classifies real fields correctly, using label text', () => {
    const fields = detectFields(loadForm());

    const fullName = fields.find((f) => f.htmlName === 'full_name');
    expect(fullName?.classification).toBe('BASIC_PROFILE');
    expect(fullName?.label).toBe('Full Name');

    const resume = fields.find((f) => f.htmlName === 'resume');
    expect(resume?.classification).toBe('FILE_UPLOAD');

    const workAuth = fields.find((f) => f.htmlName === 'work_auth');
    expect(workAuth?.classification).toBe('WORK_AUTHORIZATION');
    expect(workAuth?.selectOptions).toEqual(['Yes', 'No']);
  });

  it('produces exactly the expected number of detected fields', () => {
    const fields = detectFields(loadForm());
    // full_name, resume, work_auth — password/hidden/submit are excluded.
    expect(fields).toHaveLength(3);
  });
});
