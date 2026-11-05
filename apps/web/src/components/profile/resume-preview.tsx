import type { Resume } from '@jobpilot/shared';
import { useTranslations } from 'next-intl';
export function ResumePreview({ data: r }: { data: Resume }) {
  const t = useTranslations('Profile');
  const dates = (start?: string, end?: string) =>
    [start, end || (start ? t('ongoing') : '')].filter(Boolean).join(' - ');
  return (
    <article className="resume-preview" aria-label={t('preview')}>
      <h2>{r.basics.name}</h2>
      <p>{r.basics.label}</p>
      <p className="resume-contact">
        {[
          r.basics.email,
          r.basics.phone,
          r.basics.location &&
            `${r.basics.location.city} ${r.basics.location.postalCode ?? ''} ${r.basics.location.country}`,
          r.basics.url,
        ]
          .filter(Boolean)
          .join(' | ')}
      </p>
      {r.basics.profiles.map((p, i) => (
        <p key={i}>
          {p.network} : {p.url}
        </p>
      ))}
      {r.basics.summary && (
        <section>
          <h3>{t('summary')}</h3>
          <p>{r.basics.summary}</p>
        </section>
      )}
      {!!r.work.length && (
        <section>
          <h3>{t('work')}</h3>
          {r.work.map((w, i) => (
            <div key={i}>
              <h4>
                {w.position} | {w.name}
              </h4>
              <p>{dates(w.startDate, w.endDate)}</p>
              <p>{w.url}</p>
              <p>{w.summary}</p>
              <ul>
                {w.highlights.map((v, j) => (
                  <li key={j}>{v}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {!!r.education.length && (
        <section>
          <h3>{t('education')}</h3>
          {r.education.map((e, i) => (
            <div key={i}>
              <h4>
                {e.studyType} {e.area} | {e.institution}
              </h4>
              <p>{dates(e.startDate, e.endDate)}</p>
              <ul>
                {e.courses.map((v, j) => (
                  <li key={j}>{v}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {!!r.skills.length && (
        <section>
          <h3>{t('skills')}</h3>
          {r.skills.map((s, i) => (
            <p key={i}>
              {[s.name, s.level, s.keywords.join(', ')]
                .filter(Boolean)
                .join(' - ')}
            </p>
          ))}
        </section>
      )}
      {!!r.languages.length && (
        <section>
          <h3>{t('languages')}</h3>
          {r.languages.map((l, i) => (
            <p key={i}>
              {l.language} - {l.fluency}
            </p>
          ))}
        </section>
      )}
      {!!r.projects.length && (
        <section>
          <h3>{t('projects')}</h3>
          {r.projects.map((p, i) => (
            <div key={i}>
              <h4>{p.name}</h4>
              <p>{p.url}</p>
              <p>{p.description}</p>
              <ul>
                {p.highlights.map((v, j) => (
                  <li key={j}>{v}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
