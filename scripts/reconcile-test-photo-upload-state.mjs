import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const execAsync = promisify(exec);
const libraryDir = resolve(process.env.PHOTO_LIBRARY_DIR ?? "fixtures/test-photo-library");
const manifest = JSON.parse((await readFile(join(libraryDir, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
const command = "SELECT id, source_file_name, original_key FROM assets WHERE source_file_name LIKE 'photo-%'";
const escapedCommand = command.replace(/"/g, '\\"');
const { stdout } = await execAsync(`npx.cmd wrangler d1 execute veld-archive --remote --command "${escapedCommand}" --json`, { maxBuffer: 10 * 1024 * 1024 });
const result = JSON.parse(stdout);
const rows = result?.[0]?.results ?? [];
const byName = new Map(rows.map((row) => [String(row.source_file_name), row]));
const state = {};
for (const item of manifest) {
  const row = byName.get(item.fileName);
  if (row) {
    state[item.sequence] = {
      assetId: row.id,
      objectKey: row.original_key,
      previewKey: String(row.original_key).replace(/^originals\//, "previews/").replace(/\.[^.\/]+$/, ".webp"),
      fileName: item.fileName,
      sourceTitle: item.sourceTitle,
    };
  }
}
await writeFile(join(libraryDir, "upload-state.json"), JSON.stringify(state, null, 2), "utf8");
console.log(JSON.stringify({ reconciled: Object.keys(state).length, remaining: manifest.length - Object.keys(state).length }, null, 2));
