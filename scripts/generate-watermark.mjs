import sharp from "sharp";

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="180">
  <text x="12" y="105" fill="white" fill-opacity="0.82" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3">STOCKVEL / PREVIEW</text>
</svg>`);

await sharp(svg).png().toFile("public/watermark.png");
console.log("Generated public/watermark.png");
