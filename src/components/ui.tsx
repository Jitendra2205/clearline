import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The visual vocabulary of the trust layer.
 *
 * Confidence, match tier and coverage appear on every screen and always look
 * the same, because a buyer should be able to learn the code once and then read
 * any grid in the product without a legend.
 */

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    bad: 'bg-red-50 text-red-800 ring-red-200',
    accent: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  }[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones}`}
    >
      {children}
    </span>
  );
}

/** High / medium / low, as reported by the extractor about its own reading. */
export function ConfidenceBadge({ level }: { level: string }) {
  const map: Record<string, { tone: 'ok' | 'warn' | 'bad'; label: string; title: string }> = {
    high: { tone: 'ok', label: 'high', title: 'Extractor read this value clearly and unambiguously.' },
    medium: { tone: 'warn', label: 'medium', title: 'Legible, but the description or basis was ambiguous. Accepted, visually flagged.' },
    low: { tone: 'bad', label: 'low', title: 'Partly illegible or reconstructed. Blocked from the comparison until a human confirms it.' },
  };
  const m = map[level] ?? { tone: 'warn' as const, label: level, title: '' };
  return <Badge tone={m.tone} title={m.title}>{m.label}</Badge>;
}

/** Which tier produced this match — the thing that makes the grid auditable. */
export function TierBadge({ tier, score }: { tier: string; score?: number | null }) {
  const map: Record<string, { tone: 'ok' | 'accent' | 'warn' | 'bad'; title: string }> = {
    exact: { tone: 'ok', title: 'Tier 1 — the vendor cited the buyer’s own line code. No inference involved.' },
    fuzzy: { tone: 'accent', title: 'Tier 2 — deterministic scoring on ply, dimensions and product type. No model involved; the same input always scores the same.' },
    semantic: { tone: 'warn', title: 'Tier 3 — a model proposal. Never counted until a human confirms it.' },
    unmatched: { tone: 'bad', title: 'No tier could match this line to the RFx. It is excluded from every comparison.' },
  };
  const m = map[tier] ?? { tone: 'warn' as const, title: '' };
  return (
    <Badge tone={m.tone} title={m.title}>
      {tier}
      {score !== null && score !== undefined && tier !== 'exact' ? (
        <span className="opacity-60">{score.toFixed(2)}</span>
      ) : null}
    </Badge>
  );
}

export function Coverage({ quoted, total }: { quoted: number; total: number }) {
  const pct = total === 0 ? 0 : quoted / total;
  const tone = pct >= 0.95 ? 'ok' : pct >= 0.6 ? 'warn' : 'bad';
  return (
    <Badge tone={tone} title={`Quoted ${quoted} of ${total} RFx lines comparably. Gaps are never estimated or imputed.`}>
      {quoted}/{total} lines
    </Badge>
  );
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** Rendered under every answer and every export. Never collapsed by default. */
export function Caveats({ items, label = 'What this excludes' }: { items: string[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((c, i) => (
          <li key={i} className="text-xs leading-relaxed text-amber-900/90">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'warn' | 'ok' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

export function Nav({ rfxId, active }: { rfxId: string; active: string }) {
  const items = [
    { href: `/rfx/${rfxId}`, key: 'overview', label: 'RFx & responses' },
    { href: `/rfx/${rfxId}/review`, key: 'review', label: 'Review queue' },
    { href: `/rfx/${rfxId}/compare`, key: 'compare', label: 'Comparison' },
    { href: `/rfx/${rfxId}/ask`, key: 'ask', label: 'Ask' },
    { href: `/rfx/${rfxId}/award`, key: 'award', label: 'Award & audit' },
  ];
  return (
    <nav className="flex gap-0.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
            active === i.key
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell({
  rfxId,
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  rfxId: string;
  active: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">
              CL
            </span>
            <span className="text-sm font-semibold tracking-tight">Clearline</span>
          </Link>
          <Nav rfxId={rfxId} active={active} />
          <div className="ml-auto">{actions}</div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="max-w-md">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
