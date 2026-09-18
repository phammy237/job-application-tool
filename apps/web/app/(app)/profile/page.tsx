import {
  getOwnProfile,
  listOwnEducation,
  listOwnExperiences,
  listOwnProjects,
  listOwnSkills,
} from '@career-os/database';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { ProfilePageClient } from './profile-page-client';

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [profile, experiences, education, projects, skills] = await Promise.all([
    getOwnProfile(supabase, user.id),
    listOwnExperiences(supabase, user.id),
    listOwnEducation(supabase, user.id),
    listOwnProjects(supabase, user.id),
    listOwnSkills(supabase, user.id),
  ]);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Only facts marked <strong>Approved</strong> and{' '}
          <strong>Usable in AI suggestions</strong> will ever be used to generate or
          autofill an application answer. See docs/AI_GROUNDING.md.
        </p>
      </div>

      <ProfilePageClient
        profile={profile}
        experiences={experiences}
        education={education}
        projects={projects}
        skills={skills}
      />
    </div>
  );
}
