import { localMinutes, parseHHMM } from './time';

/** Same rules as bridge/src/attendance.js computeStats. */
export function computeStats(rec, settings) {
  const start = parseHHMM(rec.workStart);
  const end = parseHHMM(rec.workEnd);
  const ci = rec.checkIn || null;
  const co = rec.checkOut || null;
  let late = 0;
  if (ci && start != null) {
    const d = localMinutes(ci) - start;
    late = d > (settings.lateGraceMinutes ?? 5) ? d : 0;
  }
  let early = 0;
  if (co && end != null) {
    const d = end - localMinutes(co);
    early = d > 0 ? d : 0;
  }
  const worked = ci && co && co > ci ? Math.round((co - ci) / 60000) : null;
  return { ...rec, lateMinutes: late, earlyMinutes: early, workedMinutes: worked };
}

export function salaryFor(rec) {
  if (!rec.workedMinutes || !rec.hourlyRate) return 0;
  return (rec.workedMinutes / 60) * rec.hourlyRate;
}
