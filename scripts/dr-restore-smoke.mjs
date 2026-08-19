import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const sqlite = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
const dbName = 'veld-archive';
const scratch = mkdtempSync(join(process.cwd(), '.dr-restore-smoke-'));
const sqlPath = join(scratch, `${dbName}.sql`);
const restoreDb = join(scratch, 'restored.sqlite');

try {
  console.log('Exporting isolated local D1 backup for restore verification');
  execFileSync(npx, ['wrangler', 'd1', 'export', dbName, '--local', '--output', sqlPath], { shell: process.platform === 'win32', stdio: 'inherit' });
  if (!existsSync(sqlPath)) throw new Error(`Backup SQL file was not found: ${sqlPath}`);

  execFileSync(sqlite, [restoreDb], { input: readFileSync(sqlPath), stdio: ['pipe', 'inherit', 'inherit'] });
  const integrity = execFileSync(sqlite, [restoreDb, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim();
  if (integrity !== 'ok') throw new Error(`Restored database integrity check failed: ${integrity}`);

  const tables = execFileSync(sqlite, [restoreDb, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','organizations','licences','payment_webhook_events');"], { encoding: 'utf8' }).trim();
  if (Number(tables) !== 4) throw new Error('Restored database is missing required production tables');
  console.log('DR restore smoke passed: isolated restore is structurally valid');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
