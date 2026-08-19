export type MonthlyPayoutSchedule = {
  nextPayoutDate: string;
  timeZone: string;
  payoutDayOfMonth: number;
};

/** Veld's published contributor payout policy: one lump sum on the 25th. */
export function monthlyPayoutSchedule(now = new Date()): MonthlyPayoutSchedule {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const next = new Date(Date.UTC(year, month - 1, 25));
  if (day >= 25) next.setUTCMonth(next.getUTCMonth() + 1);
  return { nextPayoutDate: next.toISOString().slice(0, 10), timeZone: "Africa/Johannesburg", payoutDayOfMonth: 25 };
}
