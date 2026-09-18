import { NextResponse } from 'next/server';
import {
  createOwnEducation,
  createOwnExperience,
  createOwnProject,
  createOwnSkill,
  getOwnProfile,
  listOwnEducation,
  listOwnExperiences,
  listOwnProjects,
  listOwnSkills,
  upsertOwnProfile,
} from '@career-os/database';
import {
  educationInputSchema,
  experienceInputSchema,
  isDuplicateEducation,
  isDuplicateExperience,
  isDuplicateProject,
  isDuplicateSkill,
  profileUpdateSchema,
  projectInputSchema,
  skillInputSchema,
} from '@career-os/shared';
import { z } from 'zod';
import { getCurrentUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';

/**
 * Resume Import step 2: "Confirm Import" — the one place approved, resume-extracted facts
 * actually reach Candidate Profile (Phase B of the onboarding-path hardening pass). The user's
 * confirmation click IS the approval event (docs' "Review / approval UI" requirement) — nothing
 * before this route ever writes to profiles/experiences/education/projects/skills, and nothing
 * the client excluded ever reaches here at all. Writes go through the EXACT same query functions
 * and Zod input schemas the manual /profile forms use (never a competing write path or a second
 * candidate-facts model), which is also why "the approval event" has one concrete meaning here:
 * every experience/education/project this route creates is written with
 * `userApproved: true, approvedForApplications: true` — the same two existing Candidate Profile
 * fields every other approval path in this product already uses (CLAUDE.md/docs/AI_GROUNDING.md),
 * never a second approval model. Resume extraction itself stays untrusted right up to this
 * point — an item becomes approved only because the authenticated user reviewed it, optionally
 * edited it, kept it included, and explicitly clicked Confirm; nothing is ever auto-approved on
 * upload or analysis. Skills already worked this way (self-entered/self-reviewed facts have
 * always defaulted to approved in this codebase); experience/education/projects previously did
 * not, which was the actual product-semantic bug this fixes — reviewing and confirming an item
 * used to still require a second, separate approval click on /profile, contradicting the
 * approval-event framing above.
 *
 * `personal` fields are OPTIONAL and INDIVIDUALLY approved by the client (conflict resolution —
 * "keep existing" vs "use resume value" — already happened client-side, before this call); any
 * field the client omits keeps its exact current stored value, never nulled (CLAUDE.md-level
 * "never silently overwrite" — enforced here by always merging onto the current profile row,
 * never sending a partial object straight to the upsert).
 */
const confirmImportRequestSchema = z.object({
  personal: z
    .object({
      fullName: z.string().min(1).nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().min(1).nullable().optional(),
      location: z.string().min(1).nullable().optional(),
      linkedin: z.string().url().nullable().optional(),
      portfolio: z.string().url().nullable().optional(),
      github: z.string().url().nullable().optional(),
      website: z.string().url().nullable().optional(),
    })
    .optional(),
  experience: z
    .array(
      z.object({
        company: z.string().min(1),
        title: z.string().min(1),
        location: z.string().nullable().default(null),
        dateRangeText: z.string().nullable().default(null),
        startDate: z.string().nullable().default(null),
        endDate: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().min(1),
        degree: z.string().nullable().default(null),
        fieldOfStudy: z.string().nullable().default(null),
        startDate: z.string().nullable().default(null),
        graduationDate: z.string().nullable().default(null),
        gpa: z.string().nullable().default(null),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().nullable().default(null),
        url: z.string().nullable().default(null),
        startDate: z.string().nullable().default(null),
        endDate: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
      }),
    )
    .default([]),
  skills: z.array(z.object({ name: z.string().min(1), category: z.string().nullable().default(null) })).default([]),
});

export interface ConfirmImportResult {
  profileUpdated: boolean;
  experiencesCreated: number;
  experiencesSkippedAsDuplicate: number;
  educationCreated: number;
  educationSkippedAsDuplicate: number;
  projectsCreated: number;
  projectsSkippedAsDuplicate: number;
  skillsCreated: number;
  skillsSkippedAsDuplicate: number;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = confirmImportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();

  try {
    let profileUpdated = false;
    if (input.personal) {
      // Merge onto the CURRENT stored profile — a field the client didn't include (not
      // approved, or unchanged) keeps its exact existing value, never nulled.
      const current = await getOwnProfile(supabase, user.id);
      const merged = profileUpdateSchema.parse({
        fullName: input.personal.fullName !== undefined ? input.personal.fullName : (current?.fullName ?? null),
        headline: current?.headline ?? null,
        email: input.personal.email !== undefined ? input.personal.email : (current?.email ?? null),
        phone: input.personal.phone !== undefined ? input.personal.phone : (current?.phone ?? null),
        location: input.personal.location !== undefined ? input.personal.location : (current?.location ?? null),
        workAuthorization: current?.workAuthorization ?? null,
        relocationPreference: current?.relocationPreference ?? null,
        links: {
          linkedin: input.personal.linkedin !== undefined ? input.personal.linkedin : (current?.links.linkedin ?? null),
          portfolio: input.personal.portfolio !== undefined ? input.personal.portfolio : (current?.links.portfolio ?? null),
          github: input.personal.github !== undefined ? input.personal.github : (current?.links.github ?? null),
          website: input.personal.website !== undefined ? input.personal.website : (current?.links.website ?? null),
        },
      });
      await upsertOwnProfile(supabase, user.id, merged);
      profileUpdated = true;
    }

    // Exact-match dedup (never fuzzy — CLAUDE.md/docs' explicit "do NOT fuzzy-merge" rule) so a
    // retried/duplicate confirm submission never creates a second identical row.
    const [existingExperiences, existingEducation, existingProjects, existingSkills] =
      await Promise.all([
        listOwnExperiences(supabase, user.id),
        listOwnEducation(supabase, user.id),
        listOwnProjects(supabase, user.id),
        listOwnSkills(supabase, user.id),
      ]);

    let experiencesCreated = 0;
    let experiencesSkippedAsDuplicate = 0;
    for (const item of input.experience) {
      const isDuplicate = isDuplicateExperience(existingExperiences, item);
      if (isDuplicate) {
        experiencesSkippedAsDuplicate += 1;
        continue;
      }
      const validated = experienceInputSchema.parse({
        sourceFactId: null,
        company: item.company,
        title: item.title,
        location: item.location,
        employmentType: null,
        startDate: item.startDate,
        endDate: item.endDate,
        description: item.description,
        tags: [],
        displayOrder: 0,
        // Confirm import IS the approval event (see this file's top-of-file doc comment) — the
        // user already reviewed, optionally edited, and explicitly kept this item included
        // before clicking Confirm, satisfying the same "explicit user action" bar every other
        // approval path in this product requires (CLAUDE.md/docs/AI_GROUNDING.md). Never true
        // before this point: the analyze route never writes anything, and an excluded item never
        // reaches here at all.
        userApproved: true,
        approvedForApplications: true,
        visibleOnPublicProfile: false,
      });
      await createOwnExperience(supabase, user.id, validated);
      experiencesCreated += 1;
    }

    let educationCreated = 0;
    let educationSkippedAsDuplicate = 0;
    for (const item of input.education) {
      const isDuplicate = isDuplicateEducation(existingEducation, item);
      if (isDuplicate) {
        educationSkippedAsDuplicate += 1;
        continue;
      }
      const validated = educationInputSchema.parse({
        sourceFactId: null,
        school: item.school,
        degree: item.degree,
        fieldOfStudy: item.fieldOfStudy,
        startDate: item.startDate,
        graduationDate: item.graduationDate,
        gpa: item.gpa,
        honors: [],
        // Confirm import IS the approval event — see the experience loop above for the full
        // reasoning, identical here.
        userApproved: true,
        approvedForApplications: true,
        visibleOnPublicProfile: false,
      });
      await createOwnEducation(supabase, user.id, validated);
      educationCreated += 1;
    }

    let projectsCreated = 0;
    let projectsSkippedAsDuplicate = 0;
    for (const item of input.projects) {
      const isDuplicate = isDuplicateProject(existingProjects, item);
      if (isDuplicate) {
        projectsSkippedAsDuplicate += 1;
        continue;
      }
      const validated = projectInputSchema.parse({
        sourceFactId: null,
        name: item.name,
        description: item.description,
        role: item.role,
        startDate: item.startDate,
        endDate: item.endDate,
        url: item.url,
        tags: [],
        // Confirm import IS the approval event — see the experience loop above for the full
        // reasoning, identical here.
        userApproved: true,
        approvedForApplications: true,
        visibleOnPublicProfile: false,
      });
      await createOwnProject(supabase, user.id, validated);
      projectsCreated += 1;
    }

    let skillsCreated = 0;
    let skillsSkippedAsDuplicate = 0;
    for (const item of input.skills) {
      const isDuplicate = isDuplicateSkill(existingSkills, item);
      if (isDuplicate) {
        skillsSkippedAsDuplicate += 1;
        continue;
      }
      const validated = skillInputSchema.parse({
        sourceFactId: null,
        name: item.name,
        category: item.category,
        proficiency: null,
        userApproved: true,
        approvedForApplications: true,
        visibleOnPublicProfile: false,
      });
      await createOwnSkill(supabase, user.id, validated);
      skillsCreated += 1;
    }

    const result: ConfirmImportResult = {
      profileUpdated,
      experiencesCreated,
      experiencesSkippedAsDuplicate,
      educationCreated,
      educationSkippedAsDuplicate,
      projectsCreated,
      projectsSkippedAsDuplicate,
      skillsCreated,
      skillsSkippedAsDuplicate,
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error('[career-os] resume import confirm failed', error);
    return NextResponse.json(
      { error: 'Could not save your approved items — please try again.' },
      { status: 500 },
    );
  }
}
