import { requireUser } from '../../../../lib/auth';
import { PageHeader } from '../_components/page-header';
import { AskView } from './ask-view';

export const metadata = { title: 'Ask my evidence' };

export default async function AskPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask my evidence"
        description="Ask in plain language what you have done and what proves it."
      />
      <AskView />
    </div>
  );
}
