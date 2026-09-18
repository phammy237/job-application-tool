'use client';

import type { Education, Experience, Profile, Project, Skill } from '@career-os/shared';
import { isDuplicateEducation, isDuplicateExperience, isDuplicateProject, isDuplicateSkill } from '@career-os/shared';
import { useMemo, useState } from 'react';
import type { ReviewedResumeImportPayload } from '../../../lib/resume-import/build-reviewed-payload';
import {
  nextPendingKey,
  type PendingEducation,
  type PendingExperience,
  type PendingProject,
  type PendingSkill,
} from '../../../lib/resume-import/pending-types';
import type { CurrentProfile } from '../../../lib/resume-import/types';
import { EducationSection } from './education-section';
import { ExperienceSection } from './experience-section';
import { ProfileForm, type ProfileFieldName } from './profile-form';
import { ProjectSection } from './project-section';
import { ResumeAutofillPanel } from './resume-autofill-panel';
import { SkillSection } from './skill-section';

/**
 * Owns the client-side state that connects the /profile résumé-autofill panel to the existing
 * Personal Information form and Experience/Education/Projects/Skills sections — page.tsx stays a
 * server component that only fetches data; every stateful autofill/staging concern lives here so
 * it can be shared across all five sections in one render tree. Nothing here ever calls a
 * database write directly: autofilled personal fields only override what ProfileForm's own
 * uncontrolled inputs default to (still persisted only by its existing "Save profile" button),
 * and staged collection items are only persisted when the user clicks that item's own
 * "Save to profile" (or "Save N skill(s)") button, which calls the exact same
 * addExperience/addEducation/addProject/addSkill server actions the manual "Add…" forms use.
 */
export function ProfilePageClient({
  profile,
  experiences,
  education,
  projects,
  skills,
}: {
  profile: Profile | null;
  experiences: Experience[];
  education: Education[];
  projects: Project[];
  skills: Skill[];
}) {
  const [personalOverrides, setPersonalOverrides] = useState<Partial<Record<ProfileFieldName, string | null>>>({});
  const [overrideVersion, setOverrideVersion] = useState(0);
  const [pendingExperience, setPendingExperience] = useState<PendingExperience[]>([]);
  const [pendingEducation, setPendingEducation] = useState<PendingEducation[]>([]);
  const [pendingProjects, setPendingProjects] = useState<PendingProject[]>([]);
  const [pendingSkills, setPendingSkills] = useState<PendingSkill[]>([]);
  const [showBanner, setShowBanner] = useState(false);

  const currentProfile: CurrentProfile | null = profile
    ? {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        linkedin: profile.links.linkedin ?? null,
        portfolio: profile.links.portfolio ?? null,
        github: profile.links.github ?? null,
        website: profile.links.website ?? null,
      }
    : null;

  // What already exists (saved rows + anything already staged this session) — passed to the
  // autofill panel so a fresh analyze defaults an exact-duplicate item to excluded, never
  // creating an obvious duplicate row (CLAUDE.md: never fuzzy-merge, exact-match only).
  const existingForDedupe = useMemo(
    () => ({
      experience: [
        ...experiences.map((e) => ({ company: e.company, title: e.title, description: e.description })),
        ...pendingExperience.map((e) => ({ company: e.company, title: e.title, description: e.description })),
      ],
      education: [
        ...education.map((e) => ({ school: e.school, degree: e.degree, fieldOfStudy: e.fieldOfStudy })),
        ...pendingEducation.map((e) => ({ school: e.school, degree: e.degree, fieldOfStudy: e.fieldOfStudy })),
      ],
      projects: [
        ...projects.map((p) => ({ name: p.name, description: p.description })),
        ...pendingProjects.map((p) => ({ name: p.name, description: p.description })),
      ],
      skills: [...skills.map((s) => ({ name: s.name })), ...pendingSkills.map((s) => ({ name: s.name }))],
    }),
    [experiences, education, projects, skills, pendingExperience, pendingEducation, pendingProjects, pendingSkills],
  );

  function handleAutofill(payload: ReviewedResumeImportPayload) {
    setPersonalOverrides((prev) => ({ ...prev, ...payload.personal }));
    setOverrideVersion((v) => v + 1);

    // Reviewed items were already deduped against `existingForDedupe` at review time (defaulted
    // to excluded there), but a second analyze -> autofill before Save still needs to guard
    // against re-adding something the FIRST autofill already staged — repeated analyze/autofill
    // must stay idempotent, never producing duplicate staged rows.
    setPendingExperience((prev) => [
      ...prev,
      ...payload.experience.filter((e) => !isDuplicateExperience(prev, e)).map((e) => ({ ...e, key: nextPendingKey('exp') })),
    ]);
    setPendingEducation((prev) => [
      ...prev,
      ...payload.education.filter((e) => !isDuplicateEducation(prev, e)).map((e) => ({ ...e, key: nextPendingKey('edu') })),
    ]);
    setPendingProjects((prev) => [
      ...prev,
      ...payload.projects.filter((p) => !isDuplicateProject(prev, p)).map((p) => ({ ...p, key: nextPendingKey('proj') })),
    ]);
    setPendingSkills((prev) => [
      ...prev,
      ...payload.skills.filter((s) => !isDuplicateSkill(prev, s)).map((s) => ({ ...s, key: nextPendingKey('skill') })),
    ]);
    setShowBanner(true);
  }

  return (
    <>
      <ResumeAutofillPanel currentProfile={currentProfile} existing={existingForDedupe} onAutofill={handleAutofill} />

      {showBanner ? (
        <div className="border-primary/40 bg-primary/5 rounded-lg border p-3 text-sm">
          Profile fields were autofilled from your résumé. Review and click Save to persist.
        </div>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Personal information</h2>
        <ProfileForm profile={profile} overrides={personalOverrides} overrideVersion={overrideVersion} />
      </section>

      <ExperienceSection
        experiences={experiences}
        pendingItems={pendingExperience}
        onPendingChange={(key, next) =>
          setPendingExperience((prev) => prev.map((p) => (p.key === key ? next : p)))
        }
        onPendingRemove={(key) => setPendingExperience((prev) => prev.filter((p) => p.key !== key))}
      />
      <EducationSection
        education={education}
        pendingItems={pendingEducation}
        onPendingChange={(key, next) =>
          setPendingEducation((prev) => prev.map((p) => (p.key === key ? next : p)))
        }
        onPendingRemove={(key) => setPendingEducation((prev) => prev.filter((p) => p.key !== key))}
      />
      <ProjectSection
        projects={projects}
        pendingItems={pendingProjects}
        onPendingChange={(key, next) =>
          setPendingProjects((prev) => prev.map((p) => (p.key === key ? next : p)))
        }
        onPendingRemove={(key) => setPendingProjects((prev) => prev.filter((p) => p.key !== key))}
      />
      <SkillSection
        skills={skills}
        pendingItems={pendingSkills}
        onPendingRemove={(key) => setPendingSkills((prev) => prev.filter((p) => p.key !== key))}
        onPendingRemoveAll={(keys) => setPendingSkills((prev) => prev.filter((p) => !keys.includes(p.key)))}
      />
    </>
  );
}
