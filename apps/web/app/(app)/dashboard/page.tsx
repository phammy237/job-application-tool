import { listOwnApplications } from '@career-os/database';
import { Card, CardContent, CardHeader, CardTitle } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const applications = await listOwnApplications(supabase, user.id);

  const activeStatuses = new Set([
    'SAVED',
    'IN_PROGRESS',
    'APPLIED',
    'APPLICATION_RECEIVED',
    'ASSESSMENT',
    'INTERVIEW',
    'ACTION_REQUIRED',
  ]);
  const stats = {
    total: applications.length,
    active: applications.filter((a) => activeStatuses.has(a.status)).length,
    interviewing: applications.filter((a) => a.status === 'INTERVIEW').length,
    offers: applications.filter((a) => a.status === 'OFFER').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Welcome back, {user.email}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Applications" value={stats.total} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Interviewing" value={stats.interviewing} />
        <StatCard label="Offers" value={stats.offers} />
      </div>

      <div className="flex gap-3">
        <Link
          href="/applications"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
        >
          View applications
        </Link>
        <Link
          href="/profile"
          className="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-4 py-2 text-sm font-medium"
        >
          Edit profile
        </Link>
      </div>

      {applications.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Fill out your profile first, then add your first application to start tracking
            it.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-1 text-sm">{label}</p>
      </CardContent>
    </Card>
  );
}
