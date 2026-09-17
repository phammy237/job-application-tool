import { getOwnProfile } from '@career-os/database';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { ResumeImportFlow } from './resume-import-flow';

export default async function ResumeImportPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const profile = await getOwnProfile(supabase, user.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import resume</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload your current résumé and Career OS will extract your experience, education,
          projects, skills, and contact details for review. Nothing is added to your Candidate
          Profile until you explicitly approve it below.
        </p>
      </div>

      <ResumeImportFlow
        currentProfile={
          profile
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
            : null
        }
      />
    </div>
  );
}
