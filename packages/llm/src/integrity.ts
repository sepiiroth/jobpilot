import { createHash } from 'node:crypto';
import type { Resume } from '@jobpilot/shared';
import type {
  DocumentContent,
  IntegrityIssue,
} from '@jobpilot/shared/generation';
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
// Exact facts stay attached to their original entry. Reordering and omissions are allowed.
// Free prose is deliberately reviewed as a whole: entity recognition cannot prove factual equivalence.
export function checkIntegrity(
  master: Resume,
  content: DocumentContent,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  function issue(path: string, value: unknown, code: IntegrityIssue['code']) {
    if (value === undefined || value === '' || value === null) return;
    const describe = (v: unknown): string => {
      if (v === undefined || v === null) return '';
      if (Array.isArray(v)) return v.map(describe).filter(Boolean).join(' · ');
      if (typeof v === 'object')
        return Object.values(v).map(describe).filter(Boolean).join(' · ');
      return String(v);
    };
    const text = describe(value);
    issues.push({
      id: fingerprint({ path, text, code }),
      path,
      code,
      value: text,
    });
  }
  function compare(
    source: unknown,
    target: unknown,
    path: string,
    prose = false,
  ) {
    if (
      target !== undefined &&
      target !== '' &&
      JSON.stringify(source) !== JSON.stringify(target)
    )
      issue(path, target, prose ? 'changed_text' : 'added_fact');
  }
  if (content.kind === 'cover_letter') {
    issue('text', content.text, 'changed_text');
    return issues;
  }
  const r = content.data;
  for (const key of [
    'name',
    'email',
    'phone',
    'url',
    'location',
    'profiles',
  ] as const)
    compare(master.basics[key], r.basics[key], 'basics.' + key);
  compare(master.basics.label, r.basics.label, 'basics.label');
  compare(master.basics.summary, r.basics.summary, 'basics.summary', true);
  r.work.forEach((w, i) => {
    const base = master.work.find(
      (b) =>
        b.name === w.name &&
        b.position === w.position &&
        b.startDate === w.startDate &&
        b.endDate === w.endDate,
    );
    if (!base) {
      issue('work.' + i, w, 'added_fact');
      return;
    }
    compare(base.url, w.url, `work.${i}.url`);
    compare(base.summary, w.summary, `work.${i}.summary`, true);
    w.highlights.forEach((v, j) => {
      if (!base.highlights.includes(v))
        issue(`work.${i}.highlights.${j}`, v, 'changed_text');
    });
  });
  r.education.forEach((e, i) => {
    const base = master.education.find(
      (b) =>
        b.institution === e.institution &&
        b.area === e.area &&
        b.studyType === e.studyType &&
        b.startDate === e.startDate &&
        b.endDate === e.endDate,
    );
    if (!base) {
      issue('education.' + i, e, 'added_fact');
      return;
    }
    e.courses.forEach((v, j) => {
      if (!base.courses.includes(v))
        issue(`education.${i}.courses.${j}`, v, 'added_fact');
    });
  });
  r.skills.forEach((s, i) => {
    const base = master.skills.find((b) => b.name === s.name);
    if (!base) {
      issue('skills.' + i, s, 'added_fact');
      return;
    }
    compare(base.level, s.level, `skills.${i}.level`);
    s.keywords.forEach((v, j) => {
      if (!base.keywords.includes(v))
        issue(`skills.${i}.keywords.${j}`, v, 'added_fact');
    });
  });
  r.languages.forEach((l, i) => {
    if (
      !master.languages.some(
        (b) => b.language === l.language && b.fluency === l.fluency,
      )
    )
      issue('languages.' + i, l, 'added_fact');
  });
  r.projects.forEach((p, i) => {
    const base = master.projects.find((b) => b.name === p.name);
    if (!base) {
      issue('projects.' + i, p, 'added_fact');
      return;
    }
    compare(base.url, p.url, `projects.${i}.url`);
    compare(base.description, p.description, `projects.${i}.description`, true);
    p.highlights.forEach((v, j) => {
      if (!base.highlights.includes(v))
        issue(`projects.${i}.highlights.${j}`, v, 'changed_text');
    });
  });
  return issues;
}
