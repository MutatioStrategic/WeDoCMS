export type ZipEntry = {
  path: string;
  body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> | string;
};

type CentralEntry = { path: Uint8Array<ArrayBuffer>; crc: number; size: number; offset: number };

const encoder = new TextEncoder();

function u16(value: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value >>> 0, true);
  return output;
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(value: number, bytes: Uint8Array): number {
  let next = value;
  for (const byte of bytes) next = crcTable[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function localHeader(path: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return concat(u32(0x04034b50), u16(20), u16(0x0008), u16(0), u16(0), u16(0), u32(0), u32(0), u32(0), u16(path.byteLength), u16(0), path);
}

function dataDescriptor(crc: number, size: number): Uint8Array<ArrayBuffer> {
  return concat(u32(0x08074b50), u32(crc), u32(size), u32(size));
}

function centralHeader(entry: CentralEntry): Uint8Array<ArrayBuffer> {
  return concat(u32(0x02014b50), u16(20), u16(20), u16(0x0008), u16(0), u16(0), u16(0), u32(entry.crc), u32(entry.size), u32(entry.size), u16(entry.path.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.path);
}

function endOfCentralDirectory(entries: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  return concat(u32(0x06054b50), u16(0), u16(0), u16(entries), u16(entries), u32(size), u32(offset), u16(0));
}

async function* chunks(body: ZipEntry["body"]): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (typeof body === "string") { yield encoder.encode(body) as Uint8Array<ArrayBuffer>; return; }
  if (body instanceof Uint8Array) { yield body; return; }
  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      if (next.value) yield next.value as Uint8Array<ArrayBuffer>;
    }
  } finally { reader.releaseLock(); }
}

/** Stream a stored ZIP while retaining only the small central directory. */
export function createStoredZip(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const central: CentralEntry[] = [];
        let offset = 0;
        for (const entry of entries) {
          const path = encoder.encode(entry.path) as Uint8Array<ArrayBuffer>;
          if (path.byteLength > 0xffff || !entry.path || entry.path.includes("..")) throw new Error("Invalid ZIP entry path");
          const header = localHeader(path);
          controller.enqueue(header); offset += header.byteLength;
          let crc = 0xffffffff;
          let size = 0;
          for await (const chunk of chunks(entry.body)) {
            size += chunk.byteLength;
            if (size > 0xffffffff) throw new Error("ZIP entry exceeds ZIP32 limits");
            crc = crc32(crc, chunk);
            controller.enqueue(chunk); offset += chunk.byteLength;
          }
          crc = (crc ^ 0xffffffff) >>> 0;
          const descriptor = dataDescriptor(crc, size);
          controller.enqueue(descriptor); offset += descriptor.byteLength;
          central.push({ path, crc, size, offset: offset - descriptor.byteLength - size - header.byteLength });
        }
        const centralOffset = offset;
        for (const entry of central) { const header = centralHeader(entry); controller.enqueue(header); offset += header.byteLength; }
        const centralSize = offset - centralOffset;
        if (central.length > 0xffff || centralSize > 0xffffffff || centralOffset > 0xffffffff) throw new Error("ZIP archive exceeds ZIP32 limits");
        controller.enqueue(endOfCentralDirectory(central.length, centralSize, centralOffset));
        controller.close();
      })().catch((error) => controller.error(error));
    },
  });
}
