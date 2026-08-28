export type EncryptedSecret = { ciphertext: string; iv: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function keyMaterial(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, encryptionKey: string, keyName: string): Promise<EncryptedSecret> {
  if (!encryptionKey.trim()) throw new Error(`${keyName} is required`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyMaterial(encryptionKey), encoder.encode(value));
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string, encryptionKey: string, keyName: string): Promise<string> {
  if (!encryptionKey.trim()) throw new Error(`${keyName} is required`);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await keyMaterial(encryptionKey), fromBase64(ciphertext));
  return decoder.decode(plaintext);
}
