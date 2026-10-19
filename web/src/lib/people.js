/** Staff / students helpers shared by the pages. */

/** "5-A", "9-B", "10-A" in school order (numbers as numbers). */
export function compareClasses(a, b) {
  const pa = /^(\d+)/.exec(a);
  const pb = /^(\d+)/.exec(b);
  if (pa && pb && pa[1] !== pb[1]) return Number(pa[1]) - Number(pb[1]);
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return a.localeCompare(b);
}

/** Classes of the active students, sorted. */
export function classList(people) {
  return [...new Set((people || []).filter((e) => e.kind === 'student' && e.className && e.active !== false).map((e) => e.className))]
    .sort(compareClasses);
}

export const isStudent = (e) => e && e.kind === 'student';

/** Tabs "Xodimlar | O'quvchilar" shown only when there are students. */
export function KindTabs({ value, onChange, counts }) {
  return (
    <div className="tabs">
      <button type="button" className={value === 'staff' ? 'on' : ''} onClick={() => onChange('staff')}>
        👔 Xodimlar{counts ? ` (${counts.staff})` : ''}
      </button>
      <button type="button" className={value === 'student' ? 'on' : ''} onClick={() => onChange('student')}>
        👦 O&apos;quvchilar{counts ? ` (${counts.student})` : ''}
      </button>
    </div>
  );
}
