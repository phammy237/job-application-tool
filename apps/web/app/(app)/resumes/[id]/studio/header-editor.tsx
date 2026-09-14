'use client';

import type { ResumeHeader } from '@career-os/shared';
import { Input, Label } from '@career-os/ui';

/**
 * The résumé version's own header — deliberately not read live from the profile
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §23): each version snapshots its own header so the
 * exact submitted résumé stays historically reproducible even if the user later changes their
 * email/phone/location on `/profile`. A new draft may be *initialized* from the current profile
 * (the studio's "Import from profile" action), but once saved, a version's header never changes.
 */
export function HeaderEditor({
  header,
  onChange,
}: {
  header: ResumeHeader;
  onChange: (next: ResumeHeader) => void;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="header-name">Full name *</Label>
        <Input
          id="header-name"
          value={header.fullName}
          onChange={(e) => onChange({ ...header, fullName: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-email">Email</Label>
        <Input
          id="header-email"
          type="email"
          value={header.email ?? ''}
          onChange={(e) => onChange({ ...header, email: e.target.value || null })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-phone">Phone</Label>
        <Input
          id="header-phone"
          value={header.phone ?? ''}
          onChange={(e) => onChange({ ...header, phone: e.target.value || null })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-location">Location</Label>
        <Input
          id="header-location"
          value={header.location ?? ''}
          onChange={(e) => onChange({ ...header, location: e.target.value || null })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-linkedin">LinkedIn URL</Label>
        <Input
          id="header-linkedin"
          value={header.links.linkedin ?? ''}
          onChange={(e) =>
            onChange({
              ...header,
              links: { ...header.links, linkedin: e.target.value || null },
            })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-github">GitHub URL</Label>
        <Input
          id="header-github"
          value={header.links.github ?? ''}
          onChange={(e) =>
            onChange({
              ...header,
              links: { ...header.links, github: e.target.value || null },
            })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-portfolio">Portfolio URL</Label>
        <Input
          id="header-portfolio"
          value={header.links.portfolio ?? ''}
          onChange={(e) =>
            onChange({
              ...header,
              links: { ...header.links, portfolio: e.target.value || null },
            })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="header-website">Website URL</Label>
        <Input
          id="header-website"
          value={header.links.website ?? ''}
          onChange={(e) =>
            onChange({
              ...header,
              links: { ...header.links, website: e.target.value || null },
            })
          }
        />
      </div>
    </section>
  );
}
