import { describe, expect, it } from "vitest";
import { catchUpR2Replication, type ReplicationBindings } from "./replication";

class MemoryBucket {
  objects = new Map<string, string>();
  puts: string[] = [];
  deletes: string[] = [];

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: unknown) {
    this.objects.set(key, String(value));
    this.puts.push(key);
  }

  async delete(key: string) {
    this.objects.delete(key);
    this.deletes.push(key);
  }
}

describe("R2 replication catch-up", () => {
  it("resumes from a saved cursor and only completes after the final page", async () => {
    const backup = new MemoryBucket();
    const media = {
      calls: [] as Array<string | undefined>,
      async list(options: { cursor?: string }) {
        this.calls.push(options.cursor);
        return options.cursor ? { objects: [{ key: "second.jpg" }], truncated: false } : { objects: [{ key: "first.jpg" }], truncated: true, cursor: "next-page" };
      },
      async get(key: string) {
        return { key, etag: key, size: 1, body: key };
      },
    };
    const mediaDr = {
      async head() { return null; },
      async put() { return undefined; },
    };
    const env = {
      MEDIA_BUCKET: media,
      MEDIA_DR_BUCKET: mediaDr,
      BACKUP_BUCKET: backup,
      OBSERVABILITY: { writeDataPoint() { return undefined; } },
      APP_ENV: "test",
    } as unknown as ReplicationBindings;
    const trace = { traceId: "a".repeat(32), spanId: "b".repeat(16), traceparent: "" };

    await catchUpR2Replication(env, trace);
    expect(media.calls).toEqual([undefined]);
    expect(backup.objects.has("r2-manifests/_catch-up-state.json")).toBe(true);
    expect(backup.deletes).toEqual([]);

    await catchUpR2Replication(env, trace);
    expect(media.calls).toEqual([undefined, "next-page"]);
    expect(backup.deletes).toEqual(["r2-manifests/_catch-up-state.json"]);
    const manifestKey = [...backup.objects.keys()].find((key) => key.startsWith("r2-manifests/"));
    expect(manifestKey).toBeDefined();
    expect(JSON.parse(backup.objects.get(manifestKey!)!).pages).toBe(2);
    expect(JSON.parse(backup.objects.get(manifestKey!)!).scanned).toBe(2);
  });
});
