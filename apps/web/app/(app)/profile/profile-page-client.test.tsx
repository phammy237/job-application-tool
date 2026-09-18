// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { Profile, ResumeExtractionResult } from '@career-os/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  addExperience: vi.fn(),
  deleteExperience: vi.fn(),
  updateExperienceApproval: vi.fn(),
  addEducation: vi.fn(),
  deleteEducation: vi.fn(),
  updateEducationApproval: vi.fn(),
  addProject: vi.fn(),
  deleteProject: vi.fn(),
  updateProjectApproval: vi.fn(),
  addSkill: vi.fn(),
  deleteSkill: vi.fn(),
}));

vi.mock('./actions', () => ({
  updateProfile: mocks.updateProfile,
  addExperience: mocks.addExperience,
  deleteExperience: mocks.deleteExperience,
  updateExperienceApproval: mocks.updateExperienceApproval,
  addEducation: mocks.addEducation,
  deleteEducation: mocks.deleteEducation,
  updateEducationApproval: mocks.updateEducationApproval,
  addProject: mocks.addProject,
  deleteProject: mocks.deleteProject,
  updateProjectApproval: mocks.updateProjectApproval,
  addSkill: mocks.addSkill,
  deleteSkill: mocks.deleteSkill,
}));

const { ProfilePageClient } = await import('./profile-page-client');

const USER_ID = '22222222-2222-4222-8222-222222222222';

const PROFILE: Profile = {
  userId: USER_ID,
  fullName: 'Existing Name',
  headline: null,
  email: null,
  phone: null,
  location: null,
  workAuthorization: null,
  relocationPreference: null,
  links: { linkedin: null, portfolio: null, github: null, website: null },
  publicSlug: null,
  visibleOnPublicProfile: false,
  onboardingCompletedAt: null,
};

const EXTRACTION_RESULT: ResumeExtractionResult = {
  personal: {
    fullName: 'Jane Doe', // conflicts with PROFILE.fullName
    email: 'jane@example.com', // no existing value — no conflict
    phone: null,
    location: null,
    linkedin: null,
    github: null,
    portfolio: null,
    website: null,
  },
  experience: [
    {
      company: 'Acme',
      title: 'Engineer',
      location: null,
      dateRangeText: 'May 2025 - Present',
      bullets: ['Built things'],
      uncertain: false,
    },
  ],
  education: [
    { school: 'State University', degree: 'BS', fieldOfStudy: 'CS', dateRangeText: '2021 - 2025', gpa: null, uncertain: false },
  ],
  projects: [{ name: 'Career OS', role: 'Author', dateRangeText: null, url: null, bullets: ['Built a tool'], uncertain: false }],
  skills: [{ name: 'TypeScript', category: null }],
  droppedCount: 0,
};

function renderPage() {
  render(
    <ProfilePageClient profile={PROFILE} experiences={[]} education={[]} projects={[]} skills={[]} />,
  );
}

async function pasteAndAnalyze() {
  fireEvent.click(screen.getByRole('button', { name: 'Paste resume text' }));
  const textarea = screen.getByPlaceholderText('Paste the text from your resume here.');
  fireEvent.change(textarea, { target: { value: 'Jane Doe\nSoftware Engineer\n'.repeat(10) } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  await waitFor(() => expect(screen.getByText('Review your résumé')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => EXTRACTION_RESULT }),
  );
  mocks.addExperience.mockResolvedValue({ error: null });
  mocks.addEducation.mockResolvedValue({ error: null });
  mocks.addProject.mockResolvedValue({ error: null });
  mocks.addSkill.mockResolvedValue({ error: null });
  mocks.updateProfile.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProfilePageClient — résumé autofill', () => {
  it('1. renders the Upload resume / Paste resume text entry points on /profile', () => {
    renderPage();
    expect(screen.getByText('Have a resume already?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste resume text' })).toBeInTheDocument();
  });

  it('6/7. analyzing never persists anything — it only shows the review screen', async () => {
    renderPage();
    await pasteAndAnalyze();

    expect(mocks.addExperience).not.toHaveBeenCalled();
    expect(mocks.addEducation).not.toHaveBeenCalled();
    expect(mocks.addProject).not.toHaveBeenCalled();
    expect(mocks.addSkill).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('8/9/10/11. review Include/Edit, then autofill applies edited collections and respects an existing conflicting personal field', async () => {
    renderPage();
    await pasteAndAnalyze();

    // Edit the experience entry's company name before including it — scoped to the review
    // screen's own "Experience" section (the real, always-rendered Experience section below it
    // also has an "Experience" heading at this point, with no entries of its own yet).
    const reviewExperienceHeading = screen.getAllByRole('heading', { name: 'Experience', level: 2 })[0]!;
    const reviewExperienceSection = reviewExperienceHeading.closest('section')!;
    fireEvent.click(within(reviewExperienceSection).getByRole('button', { name: 'Edit' }));
    const companyInput = screen.getByDisplayValue('Acme');
    fireEvent.change(companyInput, { target: { value: 'Acme Corp Edited' } });

    fireEvent.click(screen.getByRole('button', { name: 'Autofill profile form' }));

    // 11. fullName conflicted with the existing profile value — defaults to keep_existing, so
    // the form must still show the EXISTING value, never silently overwritten.
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Existing Name'));

    // 9. email had no existing value — no conflict — autofills straight through.
    expect(screen.getByLabelText('Contact email')).toHaveValue('jane@example.com');

    // 10/8. the edited experience value flowed through into a staged card in the section below.
    expect(screen.getByDisplayValue('Acme Corp Edited')).toBeInTheDocument();
    // 10. education/projects/skills all autofilled as staged, not-yet-saved items too.
    expect(screen.getByDisplayValue('State University')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Career OS')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    expect(screen.getByText(/autofilled from your résumé/i)).toBeInTheDocument();

    // Nothing was persisted merely by autofilling.
    expect(mocks.addExperience).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('12. clicking "Save to profile" on a staged experience card persists it via the existing addExperience action and removes it from staging', async () => {
    renderPage();
    await pasteAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: 'Autofill profile form' }));
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument());

    const experienceSection = screen.getByRole('heading', { name: 'Experience', level: 2 }).closest('section')!;
    fireEvent.click(within(experienceSection).getByRole('button', { name: 'Save to profile' }));

    await waitFor(() => expect(mocks.addExperience).toHaveBeenCalledTimes(1));
    const [, fd] = mocks.addExperience.mock.calls[0] as [unknown, FormData];
    expect(fd.get('company')).toBe('Acme');
    expect(fd.get('title')).toBe('Engineer');
    expect(fd.get('userApproved')).toBe('on');
    expect(fd.get('approvedForApplications')).toBe('on');

    await waitFor(() => expect(screen.queryByDisplayValue('Acme')).not.toBeInTheDocument());
  });

  it('13. repeating analyze + autofill with the same résumé does not create a duplicate staged entry', async () => {
    renderPage();

    await pasteAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: 'Autofill profile form' }));
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument());

    // Run the exact same analyze -> autofill sequence again without saving in between.
    await pasteAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: 'Autofill profile form' }));

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Acme')).toHaveLength(1);
    });
    expect(screen.getAllByDisplayValue('State University')).toHaveLength(1);
    expect(screen.getAllByDisplayValue('Career OS')).toHaveLength(1);
  });

  it('cross-user isolation is inherited from the underlying server actions — the staged card calls the same addExperience the manual "Add experience" form uses, never a second write path', async () => {
    renderPage();
    await pasteAndAnalyze();
    fireEvent.click(screen.getByRole('button', { name: 'Autofill profile form' }));
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument());

    const experienceSection = screen.getByRole('heading', { name: 'Experience', level: 2 }).closest('section')!;
    fireEvent.click(within(experienceSection).getByRole('button', { name: 'Save to profile' }));
    await waitFor(() => expect(mocks.addExperience).toHaveBeenCalledTimes(1));
    // Same function reference used by the manual add-experience form — proven separately, in
    // apps/web/app/(app)/profile/actions.test.ts, to derive userId only from the session.
  });
});
