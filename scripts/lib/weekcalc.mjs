// Календарь недели по правилам рассылки:
// окно данных — пн 00:00 … пт 19:00 (Москва); суббота входит, только если рабочая по календарю РФ;
// воскресенье не входит никогда.
import { moscowParts } from "./planfix.mjs";

function iso(d) {
  return d.toISOString().slice(0, 10);
}
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // пн=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

// ISO-номер недели (как в письмах: «40 неделя»).
export function isoWeekNumber(mondayStr) {
  const mon = new Date(mondayStr + "T00:00:00Z");
  const thu = addDays(mon, 3);
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return Math.ceil((((thu - yearStart) / 86400000) + 1) / 7);
}

// Собирает окно недели, минувшей на дату сборки (buildDate — обычно суббота 23:00 МСК).
// workingSaturdays — массив 'YYYY-MM-DD' рабочих суббот (переносы выходных РФ), пустой по умолчанию.
export function weekWindow(buildDate = new Date(), { workingSaturdays = [] } = {}) {
  const p = moscowParts(buildDate);
  const mskToday = `${p.year}-${p.month}-${p.day}`;
  const mon = mondayOf(mskToday);
  const monStr = iso(mon);
  const satStr = iso(addDays(mon, 5));
  const satIncluded = workingSaturdays.includes(satStr);
  const w1 = satIncluded ? satStr : iso(addDays(mon, 4));
  return {
    w0: monStr,
    w1,
    weekN: isoWeekNumber(monStr),
    saturdayIncluded: satIncluded,
    // Срез ПланФикса: пятница 19:00 Москвы (если пятница в окне), иначе конец окна.
    cutoff: iso(addDays(mon, 4)) + "T19:00",
  };
}

export function fmtRange(w0, w1) {
  const f = (s) => `${+s.slice(8, 10)}.${s.slice(5, 7)}`;
  return `${f(w0)}–${f(w1)}`;
}
