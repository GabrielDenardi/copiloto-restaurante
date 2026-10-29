const dayInMs = 86_400_000

export const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const

export type WeekdayName = (typeof weekdayNames)[number]

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = parseDate(value)
  return !Number.isNaN(date.getTime()) && formatDate(date) === value
}

export function addDays(value: string, days: number): string {
  return formatDate(new Date(parseDate(value).getTime() + days * dayInMs))
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / dayInMs)
}

export function eachDay(start: string, end: string): string[] {
  return Array.from({ length: daysBetween(start, end) + 1 }, (_, index) => addDays(start, index))
}

export function weekdayOf(value: string): number {
  return parseDate(value).getUTCDay()
}

export function formatTimestamp(day: string, minutesFromMidnight: number): string {
  return new Date(parseDate(day).getTime() + minutesFromMidnight * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ")
}
