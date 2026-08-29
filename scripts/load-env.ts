/**
 * Loads .env.local for the CLI scripts.
 *
 * Next.js does this automatically for the app; a script run under tsx does not,
 * so `npm run extract` would otherwise report a missing key that is sitting
 * right there in the file. Import this first, before anything that reads
 * process.env.
 */

import fs from 'node:fs';
import path from 'node:path';

for (const name of ['.env.local', '.env']) {
  const file = path.join(process.cwd(), name);
  if (!fs.existsSync(file)) continue;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
