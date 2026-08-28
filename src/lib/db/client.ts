import { createClient, type Client, type InValue } from '@libsql/client';
import { SCHEMA_SQL } from './schema';
import fs from 'node:fs';
import path from 'node:path';

/**
 * One libSQL client for the process.
 *
 * Local dev  -> file:<appRoot>/data/clearline.db  (a real file, survives restarts)
 * Container  -> the same, on a mounted disk
 * Serverless -> Turso (LIBSQL_URL=libsql://… + LIBSQL_AUTH_TOKEN)
 *
 * Chosen over Postgres so the identical code path runs on a laptop with zero
 * provisioning and on a host with one env var.
 */

let _client: Client | null = null;
let _ready: Promise<void> | null = null;

/**
 * The directory containing package.json, not whatever directory the process
 * happened to be started from. A CLI run from a subfolder and a dev server
 * launched from elsewhere must open the same database file, or you get a
 * silently empty app instead of an error.
 */
function appRoot(): string {
  const starts: string[] = [process.cwd()];
  try {
    // Undefined when this module is loaded as CommonJS, hence the guard.
    const here = import.meta?.url;
    if (here) starts.push(path.dirname(new URL(here).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  } catch {
    // Fall through — cwd alone is correct in every normal deployment.
  }

  const seen = new Set<string>();
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function makeClient(): Client {
  const url = process.env.LIBSQL_URL;
  if (url && url.startsWith('libsql://')) {
    return createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN });
  }

  const file = url ?? `file:${path.join(appRoot(), 'data', 'clearline.db')}`;
  if (file.startsWith('file:')) {
    fs.mkdirSync(path.dirname(file.slice(5)), { recursive: true });
  }
  return createClient({ url: file });
}

/** Exposed so scripts can report which database they are actually touching. */
export function dbLocation(): string {
  const url = process.env.LIBSQL_URL;
  if (url?.startsWith('libsql://')) return url;
  return url ?? path.join(appRoot(), 'data', 'clearline.db');
}

export function db(): Client {
  if (!_client) _client = makeClient();
  return _client;
}

/** Idempotent migrate-on-boot. Fine at this scale; a real deploy would use versioned migrations. */
export function ready(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      // Strip line comments before splitting — a `;` inside a comment would
      // otherwise cut a CREATE TABLE in half.
      const statements = SCHEMA_SQL
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const s of statements) await db().execute(s);
    })();
  }
  return _ready;
}

export type Row = Record<string, unknown>;

export async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  await ready();
  const rs = await db().execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function one<T = Row>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  await ready();
  await db().execute({ sql, args });
}

export async function batch(items: { sql: string; args: InValue[] }[]): Promise<void> {
  await ready();
  if (items.length === 0) return;
  await db().batch(items, 'write');
}

export const j = {
  parse<T>(v: unknown, fallback: T): T {
    if (typeof v !== 'string') return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  },
  stringify(v: unknown): string {
    return JSON.stringify(v ?? null);
  },
};
