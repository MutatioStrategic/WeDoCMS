export type R2PresignBindings = {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

async function hmac(key: Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, utf8(value))) as Uint8Array<ArrayBuffer>;
}

async function hex(value: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

/** Creates a short-lived R2 S3 URL without exposing credentials to callers. */
export async function createPresignedR2Url(
  env: R2PresignBindings,
  bucketName: string | undefined,
  objectKey: string,
  method: "GET" | "PUT",
  expiresSeconds = 900,
  responseOverrides?: { contentDisposition?: string; contentType?: string },
): Promise<string | null> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !bucketName) return null;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  // R2 presigned URLs use the virtual-hosted S3 endpoint: bucket.account.r2...
  // The bucket is therefore part of the host and must not be repeated in the path.
  const host = `${bucketName}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const credential = `${env.R2_ACCESS_KEY_ID}/${dateStamp}/${region}/${service}/aws4_request`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  });
  if (responseOverrides?.contentDisposition) query.set("response-content-disposition", responseOverrides.contentDisposition);
  if (responseOverrides?.contentType) query.set("response-content-type", responseOverrides.contentType);
  const canonicalQuery = [...query.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonicalUri = `/${encodePath(objectKey)}`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const canonicalRequestHash = await hex(await crypto.subtle.digest("SHA-256", utf8(canonicalRequest)));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, `${dateStamp}/${region}/${service}/aws4_request`, canonicalRequestHash].join("\n");
  const dateKey = await hmac(utf8(`AWS4${env.R2_SECRET_ACCESS_KEY}`), dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  const signingKey = await hmac(serviceKey, "aws4_request");
  query.set("X-Amz-Signature", await hex(await hmac(signingKey, stringToSign)));
  return `https://${host}${canonicalUri}?${query.toString()}`;
}
