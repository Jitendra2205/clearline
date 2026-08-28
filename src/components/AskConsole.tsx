'use client';

import { useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Badge, Caveats, Panel, EmptyState } from './ui';

interface ChartSpec {
  type: string;
  title: string;
  xKey: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
  valueFormat: 'money' | 'number' | 'percent';
}

interface QueryResult {
  kind: string;
  filtersApplied: string[];
  caveats: string[];
  columns: string[];
  rows: (string | number | null)[][];
  chart: ChartSpec | null;
  meta: Record<string, unknown>;
}

interface Turn {
  question: string;
  answer: string;
  toolCalls: { name: string; result?: QueryResult }[];
  error: string | null;
  running: boolean;
}

/**
 * The questions worth asking on a live demo. Each one exercises a different
 * failure mode: coverage, the quality gate, unit conversion, a footnote
 * discount, and one the system must refuse.
 */
const SUGGESTIONS = [
  'What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?',
  'Who is cheapest overall, and is that a like-for-like comparison?',
  'Which vendors did not quote the full schedule, and what did they leave out?',
  'Show me line CP-016 across all vendors and explain how the per-kg price was arrived at.',
  'What discounts did any vendor offer, and are they reflected in the prices I am seeing?',
  'What is the system unsure about right now, and could resolving it change who wins?',
  'What is Shakti Board Works’ production capacity in Chennai?',
];

const MONEY = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function AskConsole({ rfxId, ready }: { rfxId: string; ready: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function submit(question: string) {
    if (!question.trim() || busy) return;
    setInput('');
    setBusy(true);

    const index = turns.length;
    setTurns((t) => [...t, { question, answer: '', toolCalls: [], error: null, running: true }]);

    const history = turns.flatMap((t) =>
      t.answer
        ? [
            { role: 'user' as const, content: t.question },
            { role: 'assistant' as const, content: t.answer },
          ]
        : [],
    );

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfxId, question, history }),
      });

      if (!res.body) throw new Error('No response stream.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as {
            type: string; name?: string; result?: QueryResult; text?: string; error?: string;
          };
          setTurns((prev) => {
            const next = [...prev];
            const t = { ...next[index] };
            if (ev.type === 'tool_call') t.toolCalls = [...t.toolCalls, { name: ev.name! }];
            if (ev.type === 'tool_result') {
              const tc = [...t.toolCalls];
              const slot = tc.findIndex((c) => c.name === ev.name && !c.result);
              if (slot >= 0) tc[slot] = { name: ev.name!, result: ev.result };
              else tc.push({ name: ev.name!, result: ev.result });
              t.toolCalls = tc;
            }
            if (ev.type === 'text') t.answer += ev.text ?? '';
            if (ev.type === 'error') t.error = ev.error ?? 'Something went wrong.';
            next[index] = t;
            return next;
          });
        }
      }
    } catch (e) {
      setTurns((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], error: e instanceof Error ? e.message : String(e) };
        return next;
      });
    } finally {
      setTurns((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], running: false };
        return next;
      });
      setBusy(false);
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }

  if (!ready) {
    return (
      <Panel>
        <EmptyState
          title="Nothing to ask about yet"
          body="No vendor documents have been extracted, so there is no normalised data to query. Run extraction from the RFx & responses tab first."
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {turns.length === 0 && (
          <Panel title="Try one of these">
            <ul className="divide-y divide-[var(--line)]">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => submit(s)}
                    className="w-full px-4 py-2.5 text-left text-[13px] leading-relaxed text-slate-700 transition hover:bg-slate-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-[var(--line)] px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
              The last one has no answer in this dataset. A system that answers it anyway has
              failed.
            </p>
          </Panel>
        )}

        {turns.map((t, i) => (
          <article key={i} className="space-y-3">
            <div className="rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white">
              {t.question}
            </div>

            {t.toolCalls.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-slate-400">Queries run</span>
                {t.toolCalls.map((c, k) => (
                  <Badge key={k} tone={c.result ? 'accent' : 'neutral'}>
                    {c.name}
                    {!c.result && <span className="opacity-60">…</span>}
                  </Badge>
                ))}
              </div>
            )}

            {t.answer && (
              <div className="panel px-4 py-3.5">
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800">{t.answer}</p>
              </div>
            )}

            {t.running && !t.answer && (
              <p className="text-[13px] text-slate-500">Running queries…</p>
            )}

            {t.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                {t.error}
              </div>
            )}

            {t.toolCalls
              .filter((c) => c.result)
              .map((c, k) => (
                <ResultBlock key={k} name={c.name} result={c.result!} />
              ))}
          </article>
        ))}
        <div ref={bottom} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="sticky bottom-4"
        >
          <div className="panel flex items-center gap-2 p-2 shadow-sm">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about this comparison…"
              disabled={busy}
              className="flex-1 bg-transparent px-2 py-1.5 text-[14px] outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
        </form>
      </div>

      <aside className="space-y-4">
        <Panel title="How this answers">
          <div className="space-y-2.5 px-4 py-3.5 text-[12.5px] leading-relaxed text-slate-600">
            <p>
              The model cannot see the data. It picks one of nine queries, the application runs
              that query against the normalised tables, and the model writes the sentence.
            </p>
            <p>
              It does no arithmetic. Every table and chart below an answer is the actual query
              result — not the model’s retelling of it.
            </p>
            <p className="text-slate-500">
              A model doing mental maths across 112 quote lines will be subtly wrong, and subtly
              wrong is the worst failure mode when the output is an award decision.
            </p>
          </div>
        </Panel>

        {turns.length > 0 && (
          <Panel title="More to ask">
            <ul className="divide-y divide-[var(--line)]">
              {SUGGESTIONS.slice(0, 5).map((s) => (
                <li key={s}>
                  <button
                    onClick={() => submit(s)}
                    disabled={busy}
                    className="w-full px-4 py-2 text-left text-[12px] leading-relaxed text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function ResultBlock({ name, result }: { name: string; result: QueryResult }) {
  const [open, setOpen] = useState(true);

  return (
    <Panel
      title={name.replace(/_/g, ' ')}
      subtitle={result.filtersApplied.join(' · ')}
      right={
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      }
    >
      {open && (
        <>
          {result.chart && result.chart.data.length > 0 && (
            <div className="border-b border-[var(--line)] px-4 py-4">
              <p className="mb-2 text-[12px] font-medium text-slate-700">{result.chart.title}</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={result.chart.data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                    <XAxis
                      dataKey={result.chart.xKey}
                      tick={{ fontSize: 11, fill: '#667085' }}
                      axisLine={{ stroke: '#e4e7ec' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#667085' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) =>
                        result.chart!.valueFormat === 'money'
                          ? `₹${(v / 1e6).toFixed(1)}M`
                          : String(v)
                      }
                    />
                    <Tooltip
                      formatter={(v) =>
                        result.chart!.valueFormat === 'money' ? MONEY(Number(v)) : String(v)
                      }
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e7ec' }}
                    />
                    {result.chart.series.map((s) => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} radius={[4, 4, 0, 0]}>
                        {result.chart!.data.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? '#2f5bd7' : '#9db4ec'} />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {result.rows.length > 0 && (
            <div className="max-h-[400px] overflow-auto">
              <table className="grid text-[12.5px]">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, k) => (
                        <td
                          key={k}
                          className={typeof cell === 'number' ? 'num whitespace-nowrap text-right' : 'text-slate-700'}
                        >
                          {cell === null ? (
                            <span className="text-slate-300">—</span>
                          ) : typeof cell === 'number' && /INR|price|cost|saving/i.test(result.columns[k] ?? '') ? (
                            MONEY(cell)
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.caveats.length > 0 && (
            <div className="px-4 py-3">
              <Caveats items={result.caveats} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
