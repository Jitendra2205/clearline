import { all, ready } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health check for the platform.
 *
 * Deliberately unauthenticated — a load balancer cannot log in — and therefore
 * deliberately says nothing commercially sensitive. Counts and configuration
 * booleans only: no vendor names, no prices, no key material.
 */
export async function GET() {
  try {
    await ready();
    const [{ n: rfx }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM rfx');
    const [{ n: docs }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM vendor_document');
    const [{ n: quotes }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM quote');

    return Response.json(
      {
        ok: true,
        rfx,
        documents: docs,
        extractedQuotes: quotes,
        modelConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
        authGate: Boolean(process.env.CLEARLINE_PASSWORD),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
