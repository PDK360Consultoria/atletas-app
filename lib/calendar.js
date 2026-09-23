const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const WEEKDAY_NAMES = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function pad(n) { return String(n).padStart(2, '0'); }

// Builds a month grid (array of weeks, each with 7 cells) mixing training
// days and race days for the dashboard's calendar card. `activities` and
// `races` are the full lists for the user — filtering to the visible month
// happens here so the caller doesn't need to run its own date math.
function buildMonthCalendar(year, month, activities, races) {
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const byDay = {};
  const ensure = (key) => { if (!byDay[key]) byDay[key] = { trainings: [], races: [] }; return byDay[key]; };
  for (const a of activities || []) {
    const iso = a.started_at || a.created_at;
    if (!iso) continue;
    ensure(String(iso).slice(0, 10)).trainings.push(a);
  }
  for (const r of races || []) {
    if (!r.race_date) continue;
    ensure(String(r.race_date).slice(0, 10)).races.push(r);
  }

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad(month)}-${pad(d)}`;
    const info = byDay[key] || { trainings: [], races: [] };
    cells.push({ day: d, key, isToday: key === todayKey, trainings: info.trainings, races: info.races });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  let prevMonth = month - 1, prevYear = year;
  if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
  let nextMonth = month + 1, nextYear = year;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }

  return {
    year, month,
    monthLabel: `${MONTH_NAMES[month - 1]} de ${year}`,
    weekdayNames: WEEKDAY_NAMES,
    weeks,
    prev: `${prevYear}-${pad(prevMonth)}`,
    next: `${nextYear}-${pad(nextMonth)}`,
  };
}

module.exports = { buildMonthCalendar };
