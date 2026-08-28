import { notFound } from 'next/navigation';
import { one, ready } from '@/lib/db/client';
import { Shell } from '@/components/ui';
import AskConsole from '@/components/AskConsole';

export const dynamic = 'force-dynamic';

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();

  const rfx = await one<{ id: string; title: string }>('SELECT id, title FROM rfx WHERE id = ?', [id]);
  if (!rfx) notFound();

  const quotes = await one<{ n: number }>('SELECT COUNT(*) AS n FROM quote WHERE rfx_id = ?', [id]);

  return (
    <Shell
      rfxId={id}
      active="ask"
      title="Ask the comparison"
      subtitle="The model chooses which query to run and writes the sentence. Every number it can quote was computed by the application and is shown to you directly underneath."
    >
      <AskConsole rfxId={id} ready={(quotes?.n ?? 0) > 0} />
    </Shell>
  );
}
