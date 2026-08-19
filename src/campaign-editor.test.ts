import { describe, expect, it } from "vitest";
import { cropPresets, derivativeForPreset, fitCrop, safeZonePercent } from "./campaign-editor";

describe("campaign editor contracts", () => {
  it("maps platform presets to traceable derivative variants", () => {
    expect(derivativeForPreset.story).toBe("story_9_16");
    expect(cropPresets.web_hero.width / cropPresets.web_hero.height).toBeCloseTo(2.4);
  });

  it("fits a crop without changing the source geometry", () => {
    expect(fitCrop(2000, 1000, 1)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(safeZonePercent(40)).toBe(30);
  });
});
