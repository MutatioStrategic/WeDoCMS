import argparse
import sqlite3
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--sql", required=True)
parser.add_argument("--database", required=True)
args = parser.parse_args()

sql_path = Path(args.sql).resolve()
database_path = Path(args.database).resolve()
if not sql_path.is_file():
    raise SystemExit(f"Backup SQL file was not found: {sql_path}")

connection = sqlite3.connect(database_path)
try:
    connection.executescript(sql_path.read_text(encoding="utf-8"))
    integrity = connection.execute("PRAGMA integrity_check;").fetchone()[0]
    if integrity != "ok":
        raise SystemExit(f"Restored database integrity check failed: {integrity}")

    required = {"users", "organizations", "licences", "payment_webhook_events", "asset_search_fts"}
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow')"
    ).fetchall()
    tables = {row[0] for row in rows}
    missing = sorted(required - tables)
    if missing:
        raise SystemExit(f"Restored database is missing required production tables: {', '.join(missing)}")

    match = connection.execute(
        "SELECT asset_id FROM asset_search_fts WHERE asset_search_fts MATCH 'Table' LIMIT 1"
    ).fetchone()
    if not match:
        raise SystemExit("Restored FTS5 index did not contain the approved Table search document")
finally:
    connection.close()

print("DR restore smoke passed: isolated restore is structurally valid and FTS5 is searchable")
