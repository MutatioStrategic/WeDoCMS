import { describe, expect, it } from "vitest";
import { monthlyPayoutSchedule } from "./payout-schedule";

describe("monthly contributor payout schedule", () => {
  it("targets the 25th of the current month before payout day", () => {
    expect(monthlyPayoutSchedule(new Date("2026-08-14T10:00:00Z"))).toMatchObject({ nextPayoutDate: "2026-08-25", payoutDayOfMonth: 25, timeZone: "Africa/Johannesburg" });
  });

  it("rolls to the next month on or after payout day", () => {
    expect(monthlyPayoutSchedule(new Date("2026-08-25T10:00:00Z")).nextPayoutDate).toBe("2026-09-25");
  });
});
