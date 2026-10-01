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

const PREFILLED_FORM_HTML = `
  <form>
    <label for="full_name">Full Name</label>
    <input id="full_name" name="full_name" type="text" value="  Jane Doe  " />

    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="" />

    <label for="notes">Notes</label>
    <textarea id="notes" name="notes">Some notes</textarea>

    <label for="school">School</label>
    <select id="school" name="school">
      <option value="">Select a school</option>
      <option value="ufl" selected>University of Florida</option>
    </select>

    <label for="terms">I agree</label>
    <input id="terms" name="terms" type="checkbox" checked />
  </form>
`;

function loadForm(): Document {
  return new JSDOM(FORM_HTML).window.document;
}

function loadPrefilledForm(): Document {
  return new JSDOM(PREFILLED_FORM_HTML).window.document;
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

  it('leaves currentValue null for genuinely empty text/file fields', () => {
    const fields = detectFields(loadForm());
    expect(fields.find((f) => f.htmlName === 'full_name')?.currentValue).toBeNull();
    expect(fields.find((f) => f.htmlName === 'resume')?.currentValue).toBeNull();
  });

  it('documents the known false-positive: a <select> with no blank placeholder option always has a browser-default selection, read as a current value', () => {
    // work_auth's first <option>Yes</option> has no explicit `selected` or empty placeholder
    // option before it, so HTML/jsdom default-selects it — indistinguishable here from a user
    // having actually chosen "Yes". See readCurrentValue's doc comment for the accepted tradeoff.
    const fields = detectFields(loadForm());
    expect(fields.find((f) => f.htmlName === 'work_auth')?.currentValue).toBe('Yes');
  });

  describe('currentValue capture (Phase 4A "already completed" detection)', () => {
    it('captures a trimmed text input value', () => {
      const fields = detectFields(loadPrefilledForm());
      expect(fields.find((f) => f.htmlName === 'full_name')?.currentValue).toBe('Jane Doe');
    });

    it('reads null (not empty string) for an empty text input', () => {
      const fields = detectFields(loadPrefilledForm());
      expect(fields.find((f) => f.htmlName === 'email')?.currentValue).toBeNull();
    });

    it('captures a filled textarea value', () => {
      const fields = detectFields(loadPrefilledForm());
      expect(fields.find((f) => f.htmlName === 'notes')?.currentValue).toBe('Some notes');
    });

    it('captures the selected option text for a select with a real selection', () => {
      const fields = detectFields(loadPrefilledForm());
      expect(fields.find((f) => f.htmlName === 'school')?.currentValue).toBe(
        'University of Florida',
      );
    });

    it('does not capture a current value for a checkbox, even when checked', () => {
      const fields = detectFields(loadPrefilledForm());
      expect(fields.find((f) => f.htmlName === 'terms')?.currentValue).toBeNull();
    });

    it('does not capture a current value for a file input', () => {
      const fields = detectFields(loadForm());
      expect(fields.find((f) => f.htmlName === 'resume')?.currentValue).toBeNull();
    });
  });
});

describe('detectFields — AUTHENTICATION exclusion beyond type="password"', () => {
  function detect(html: string) {
    return detectFields(new JSDOM(html).window.document);
  }

  it('excludes a password revealed by a "show password" toggle (type="text", named like a password)', () => {
    const fields = detect(`
      <form>
        <label for="n">Full name</label><input id="n" name="full_name" />
        <label for="e">Email</label><input id="e" name="email" type="email" />
        <label for="p">Password</label><input id="p" name="userPassword" type="text" value="hunter2" />
        <label for="c">City</label><input id="c" name="city" />
      </form>`);
    expect(fields.map((f) => f.htmlName)).toEqual(['full_name', 'email', 'city']);
    expect(fields.some((f) => f.currentValue === 'hunter2')).toBe(false);
  });

  it.each([
    ['autocomplete one-time-code', '<input name="code" autocomplete="one-time-code" value="123456" />'],
    ['autocomplete new-password', '<input name="x" type="text" autocomplete="new-password" />'],
    ['autocomplete username', '<input name="login_id" autocomplete="username" />'],
    ['an OTP name', '<input name="otp_code" value="123456" />'],
    ['a 2FA label', '<label for="t">Enter your 2FA code</label><input id="t" name="t" />'],
    ['a verification-code placeholder', '<input name="vc" placeholder="Verification code" />'],
  ])('excludes a field identified by %s', (_description, input) => {
    const fields = detect(`
      <form>
        <label for="n">Full name</label><input id="n" name="full_name" />
        ${input}
        <label for="c">City</label><input id="c" name="city" />
        <label for="s">School</label><input id="s" name="school" />
      </form>`);
    expect(fields.map((f) => f.htmlName)).toEqual(['full_name', 'city', 'school']);
  });

  it('excludes every field of a sign-in form (password + at most two other fields)', () => {
    const fields = detect(`
      <form>
        <label for="e">Email</label><input id="e" name="email" type="email" value="me@example.com" />
        <label for="p">Password</label><input id="p" name="pw" type="password" />
        <label for="r">Remember me</label><input id="r" name="remember" type="checkbox" />
        <input type="submit" value="Sign in" />
      </form>`);
    expect(fields).toEqual([]);
  });

  it('still scans an application form that embeds a create-account password step', () => {
    const fields = detect(`
      <form>
        <label for="n">Full name</label><input id="n" name="full_name" />
        <label for="e">Email</label><input id="e" name="email" type="email" />
        <label for="ph">Phone</label><input id="ph" name="phone" />
        <label for="p">Create a password</label><input id="p" name="pw" type="password" />
      </form>`);
    expect(fields.map((f) => f.htmlName)).toEqual(['full_name', 'email', 'phone']);
  });

  it('does not over-match look-alike words (passport, photo, stop)', () => {
    const fields = detect(`
      <form>
        <label for="a">Passport number</label><input id="a" name="passport_number" />
        <label for="b">Photo URL</label><input id="b" name="photo_url" />
        <label for="c">Bus stop</label><input id="c" name="stop" />
      </form>`);
    expect(fields.map((f) => f.htmlName)).toEqual(['passport_number', 'photo_url', 'stop']);
  });
});
