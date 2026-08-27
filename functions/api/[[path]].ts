type PagesEnv = {
  WORKER_API_ORIGIN?: string;
};

const defaultWorkerOrigin = "https://veld-archive-api-production.blewisorlando.workers.dev";

export const onRequest: PagesFunction<PagesEnv> = async ({ env, request }) => {
  const incomingUrl = new URL(request.url);
  const workerOrigin = (env.WORKER_API_ORIGIN ?? defaultWorkerOrigin).replace(/\/$/, "");
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, workerOrigin);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", incomingUrl.host);
  headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));

  const response = await fetch(new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  }));

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return response;

  const next = new Response(response.body, response);
  next.headers.set("Cache-Control", "no-store");
  return next;
};
