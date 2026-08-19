import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const imageRoot = resolve(process.env.LOCAL_VISION_IMAGE_ROOT ?? "fixtures");
const imagePath = resolve(process.argv[2] ?? "fixtures/demo-media/garden-route-south-africa.jpg");
const relativeImagePath = relative(imageRoot, imagePath);
if (relativeImagePath.startsWith("..") || isAbsolute(relativeImagePath)) throw new Error(`Image path must stay inside ${imageRoot}`);
const image = (await readFile(imagePath)).toString("base64");
const response = await fetch(process.env.LOCAL_VISION_URL ?? "http://127.0.0.1:11434/api/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: process.env.LOCAL_VISION_MODEL ?? "moondream",
    prompt: "Describe only what is visibly present in this image. Return one concise factual sentence.",
    images: [image],
    stream: false,
    think: false,
  }),
});
if (!response.ok) throw new Error(`Local vision provider returned HTTP ${response.status}`);
const body = await response.json();
const responseText = body.response || body.thinking;
const output = typeof responseText === "string" ? responseText.trim() : "";
if (!output) throw new Error("Local vision provider returned no text");
console.log(JSON.stringify({ ok: true, model: body.model ?? process.env.LOCAL_VISION_MODEL ?? "moondream", imagePath, output }, null, 2));
