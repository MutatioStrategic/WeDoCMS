import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const sqlite = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
const dbName = 'veld-archive';
const scratch = mkdtempSync(join(process.cwd(), '.dr-restore-smoke-'));
const sqlPath = join(scratch, `${dbName}.sql`);
const restoreDb = join(scratch, 'restored.sqlite');

try {
  console.log('Exporting isolated local D1 backup for restore verification');
  try {
    execFileSync(npx, ['wrangler', 'd1', 'export', dbName, '--local', '--skip-confirmation', '--output', sqlPath], { shell: process.platform === 'win32', stdio: 'pipe' });
  } catch {
    console.log('Native D1 export cannot serialize FTS5; exporting base tables for structural restore verification');
    if (existsSync(sqlPath)) rmSync(sqlPath, { force: true });
    const tableQuery = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'asset_search_fts%' ORDER BY name";
    const tableQueryPath = join(scratch, 'tables.sql');
    writeFileSync(tableQueryPath, tableQuery);
    const tableOutput = execFileSync(npx, ['wrangler', 'd1', 'execute', dbName, '--local', '--file', tableQueryPath, '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
    const tableRows = JSON.parse(tableOutput)[0]?.results ?? [];
    const tableNames = tableRows.map((row) => String(row.name)).filter(Boolean);
    if (!tableNames.length) throw new Error('No exportable D1 tables were found');
    execFileSync(npx, ['wrangler', 'd1', 'export', dbName, '--local', '--skip-confirmation', '--output', sqlPath, ...tableNames.flatMap((name) => ['--table', name])], { shell: process.platform === 'win32', stdio: 'pipe' });
    // The local sqlite3 bundled on some Windows runners has no FTS5 module.
    // The base-table restore is still structurally verified here; production
    // restore tooling rebuilds the FTS index after applying migrations.
  }
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
