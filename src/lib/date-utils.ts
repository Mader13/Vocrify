/**
 * Simple date formatting utilities (KISS principle - no heavy dependencies)
 */

const TIME_UNITS = {
  year: 365 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
  second: 1000,
};

/**
 * Format distance to now in English
 * @param date - The date to format
 * @returns Formatted string like "5 minutes ago"
 */
export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();

  if (diff < TIME_UNITS.second) {
    return "just now";
  }

  if (diff < TIME_UNITS.minute) {
    const seconds = Math.floor(diff / TIME_UNITS.second);
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`;
  }

  if (diff < TIME_UNITS.hour) {
    const minutes = Math.floor(diff / TIME_UNITS.minute);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  if (diff < TIME_UNITS.day) {
    const hours = Math.floor(diff / TIME_UNITS.hour);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  if (diff < TIME_UNITS.week) {
    const days = Math.floor(diff / TIME_UNITS.day);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  if (diff < TIME_UNITS.month) {
    const weeks = Math.floor(diff / TIME_UNITS.week);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }

  if (diff < TIME_UNITS.year) {
    const months = Math.floor(diff / TIME_UNITS.month);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }

  const years = Math.floor(diff / TIME_UNITS.year);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}
