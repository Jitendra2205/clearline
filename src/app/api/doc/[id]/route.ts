import { requireAuth } from '@/lib/security/auth';
import { verifyDocToken } from '@/lib/security/signed';
import { one } from '@/lib/db/client';

export const runtime = 'nodejs';

/**
 * Serves a vendor document.
 *
 * Two gates, not one: the session must be authenticated AND the request must
 * carry a short-TTL signed token minted server-side for this specific document.
 * Quote documents are commercially sensitive; there is no public path to them.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get('t');

  if (!verifyDocToken(id, token)) {
    return Response.json({ error: 'Link expired or invalid. Reload the page.' }, { status: 403 });
  }

  const doc = await one<{ filename: string; mime: string; content: string }>(
    'SELECT filename, mime, content FROM vendor_document WHERE id = ?',
    [id],
  );
  if (!doc) return Response.json({ error: 'Not found' }, { status: 404 });

  const buf = Buffer.from(doc.content, 'base64');
  const inlineOk = doc.mime.startsWith('image/') || doc.mime === 'application/pdf';

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': doc.mime,
      // Anything not an image or PDF is downloaded, never rendered in the page.
      'Content-Disposition': `${inlineOk ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
    },
  });
}
