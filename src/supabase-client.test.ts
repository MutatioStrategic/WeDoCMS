import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url: string, key: string) => ({ url, key })),
}));

describe("Supabase browser client", () => {
  it("reuses one GoTrue client for matching runtime and build-time credentials", () => {
    const first = getSupabaseClient("https://tenant.supabase.co", "public-key");
    const second = getSupabaseClient(" https://tenant.supabase.co/ ", " public-key ");

    expect(second).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
