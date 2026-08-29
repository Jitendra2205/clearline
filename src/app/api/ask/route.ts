import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { ask } from '@/lib/ai/ask';
import { run, j } from '@/lib/db/client';
import { ModelUnavailableError } from '@/lib/ai/provider';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Streams the analyst answer as newline-delimited JSON events.
 *
 * The client renders tool results as real tables and charts as they arrive, so
 * the buyer watches the query being run rather than reading a summary of it.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { rfxId, question, history } = (await req.json()) as {
    rfxId?: string;
    question?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  };

  if (!rfxId || !question?.trim()) {
    return Response.json({ error: 'rfxId and question are required.' }, { status: 400 });
  }

  const priorTurns = (history ?? [])
    .slice(-6)
    .map((h) => ({ role: h.role, content: h.content }));

  const encoder = new TextEncoder();
  const toolResults: unknown[] = [];
  let answer = '';

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));

      try {
        for await (const ev of ask(rfxId, priorTurns, question)) {
          if (ev.type === 'text' && ev.text) answer += ev.text;
          if (ev.type === 'tool_result') toolResults.push({ name: ev.name, result: ev.result });
          send(ev);
        }
      } catch (e) {
        send({
          type: 'error',
          error:
            e instanceof ModelUnavailableError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e),
        });
      } finally {
        try {
          await run(
            `INSERT INTO qa_turn (id, rfx_id, question, plan_json, result_json, answer, created_at)
             VALUES (?,?,?,?,?,?,?)`,
            [
              `qa_${nanoid(12)}`, rfxId, question,
              j.stringify(toolResults.map((t) => (t as { name: string }).name)),
              j.stringify(toolResults), answer, new Date().toISOString(),
            ],
          );
        } catch {
          // Transcript persistence must never break the answer already streamed.
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
