export const AUTOMATIC_PRICE_CHECK_TASK_KEY = "automatic-price-check";

// Fixed daily check times: 4:10 AM, 12:00 PM, 8:00 PM
export const AUTOMATIC_PRICE_CHECK_TIMES = [
  { hour: 4, minute: 10, label: "4:10 AM" },
  { hour: 12, minute: 0, label: "12:00 PM" },
  { hour: 20, minute: 0, label: "8:00 PM" },
] as const;

export function getNextScheduledCheckTime(from = new Date()): Date {
  const candidates = AUTOMATIC_PRICE_CHECK_TIMES.map(({ hour, minute }) => {
    const target = new Date(from);
    target.setHours(hour, minute, 0, 0);
    return target;
  });

  // Find the first slot today that is at least 30 seconds in the future
  const nextToday = candidates.find((c) => c.getTime() > from.getTime() + 30_000);
  if (nextToday) {
    return nextToday;
  }

  // All slots today have passed, pick the first slot tomorrow
  const firstTomorrow = new Date(candidates[0]);
  firstTomorrow.setDate(firstTomorrow.getDate() + 1);
  return firstTomorrow;
}
