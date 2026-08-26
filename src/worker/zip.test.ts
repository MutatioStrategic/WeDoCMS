import { describe, expect, it } from "vitest";
import { createStoredZip } from "./zip";

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("streamed stored ZIP", () => {
  it("writes a readable archive without buffering the source entries", async () => {
    const stream = createStoredZip([
      { path: "manifest.json", body: "{\"ok\":true}" },
      { path: "media/large.bin", body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }) },
    ]);
    const archive = await bytes(stream);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(archive)).toContain("manifest.json");
    expect(view.getUint32(archive.byteLength - 22, true)).toBe(0x06054b50);
  });

  it("rejects traversal paths", async () => {
    const stream = createStoredZip([{ path: "../private.txt", body: "nope" }]);
    await expect(bytes(stream)).rejects.toThrow("Invalid ZIP entry path");
  });
});
