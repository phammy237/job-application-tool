import { requireUser } from '../../../../lib/auth';
import { AskView } from './ask-view';

export const metadata = { title: 'Ask my evidence' };

export default async function AskPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ask my evidence</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask in plain language what you have done and what proves it.
        </p>
      </header>
      <AskView />
    </div>
  );
}
