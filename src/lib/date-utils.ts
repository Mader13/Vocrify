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
 * Format distance to now in Russian
 * @param date - The date to format
 * @returns Formatted string like "5 минут назад"
 */
export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();

  if (diff < TIME_UNITS.second) {
    return "только что";
  }

  if (diff < TIME_UNITS.minute) {
    const seconds = Math.floor(diff / TIME_UNITS.second);
    return formatPlural(seconds, ["секунду", "секунды", "секунд"], "назад");
  }

  if (diff < TIME_UNITS.hour) {
    const minutes = Math.floor(diff / TIME_UNITS.minute);
    return formatPlural(minutes, ["минуту", "минуты", "минут"], "назад");
  }

  if (diff < TIME_UNITS.day) {
    const hours = Math.floor(diff / TIME_UNITS.hour);
    return formatPlural(hours, ["час", "часа", "часов"], "назад");
  }

  if (diff < TIME_UNITS.week) {
    const days = Math.floor(diff / TIME_UNITS.day);
    return formatPlural(days, ["день", "дня", "дней"], "назад");
  }

  if (diff < TIME_UNITS.month) {
    const weeks = Math.floor(diff / TIME_UNITS.week);
    return formatPlural(weeks, ["неделю", "недели", "недель"], "назад");
  }

  if (diff < TIME_UNITS.year) {
    const months = Math.floor(diff / TIME_UNITS.month);
    return formatPlural(months, ["месяц", "месяца", "месяцев"], "назад");
  }

  const years = Math.floor(diff / TIME_UNITS.year);
  return formatPlural(years, ["год", "года", "лет"], "назад");
}

/**
 * Format plural forms for Russian language
 */
function formatPlural(
  value: number,
  forms: [one: string, few: string, many: string],
  suffix: string
): string {
  const lastTwo = value % 100;
  const lastOne = value % 10;

  let form: string;

  if (lastTwo >= 11 && lastTwo <= 19) {
    form = forms[2];
  } else if (lastOne === 1) {
    form = forms[0];
  } else if (lastOne >= 2 && lastOne <= 4) {
    form = forms[1];
  } else {
    form = forms[2];
  }

  return `${value} ${form} ${suffix}`;
}
