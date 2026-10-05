import { notFound } from 'next/navigation';
import { requireUser } from '../../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../../lib/myos/load-graph';
import { StoryDetailView } from './story-detail-view';

export const metadata = { title: 'Story · myOS' };

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  const story = graph.stories.find((s) => s.id === id);
  if (!story) notFound();
  return <StoryDetailView graph={graph} story={story} />;
}
