import { createElement as h } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import { resumeSchema, type Resume } from '@jobpilot/shared';
const styles = StyleSheet.create({
  page: {
    padding: 42,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
    color: '#18212d',
  },
  name: {
    fontSize: 24,
    lineHeight: 1.2,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  label: { fontSize: 13, lineHeight: 1.3, marginBottom: 7 },
  heading: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    marginTop: 15,
    marginBottom: 6,
    borderBottomWidth: 0.6,
    borderBottomColor: '#b0b7bf',
    paddingBottom: 3,
  },
  entry: { marginBottom: 9 },
  strong: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#4d5866' },
});
function text(value: string | undefined, strong = false) {
  return value ? h(Text, { style: strong ? styles.strong : {} }, value) : null;
}
function dates(start?: string, end?: string, language: 'fr' | 'en' = 'fr') {
  return [
    start,
    end || (start ? (language === 'fr' ? 'En cours' : 'Present') : ''),
  ]
    .filter(Boolean)
    .join(' - ');
}
function section(title: string, content: ReturnType<typeof h>[]) {
  return content.length
    ? h(
        View,
        {},
        h(Text, { style: styles.heading, minPresenceAhead: 40 }, title),
        ...content,
      )
    : null;
}
export async function renderResumePdf(
  input: Resume,
  language: 'fr' | 'en' = 'fr',
) {
  const r = resumeSchema.parse(input);
  const basics = r.basics;
  return renderToBuffer(
    h(
      Document,
      { title: basics.name, author: basics.name, language },
      h(
        Page,
        { size: 'A4', style: styles.page },
        h(Text, { style: styles.name }, basics.name),
        basics.label ? h(Text, { style: styles.label }, basics.label) : null,
        h(
          Text,
          { style: styles.muted },
          [
            basics.email,
            basics.phone,
            basics.location
              ? [
                  basics.location.city,
                  basics.location.postalCode,
                  basics.location.country,
                ]
                  .filter(Boolean)
                  .join(' ')
              : '',
            basics.url,
          ]
            .filter(Boolean)
            .join(' | '),
        ),
        ...basics.profiles.map((p) => text(`${p.network} : ${p.url}`)),
        basics.summary
          ? section(language === 'fr' ? 'Profil' : 'Profile', [
              h(Text, {}, basics.summary),
            ])
          : null,
        section(
          language === 'fr' ? 'Expériences' : 'Experience',
          r.work.map((w) =>
            h(
              View,
              { style: styles.entry },
              text(`${w.position} | ${w.name}`, true),
              text(dates(w.startDate, w.endDate, language)),
              text(w.url),
              text(w.summary),
              ...w.highlights.map((v) => text(`- ${v}`)),
            ),
          ),
        ),
        section(
          language === 'fr' ? 'Formation' : 'Education',
          r.education.map((e) =>
            h(
              View,
              { style: styles.entry },
              text(`${e.studyType} ${e.area} | ${e.institution}`, true),
              text(dates(e.startDate, e.endDate, language)),
              ...e.courses.map((v) => text(`- ${v}`)),
            ),
          ),
        ),
        section(
          language === 'fr' ? 'Compétences' : 'Skills',
          r.skills.map((s) =>
            h(
              Text,
              { style: styles.entry },
              [s.name, s.level, s.keywords.join(', ')]
                .filter(Boolean)
                .join(' - '),
            ),
          ),
        ),
        section(
          language === 'fr' ? 'Langues' : 'Languages',
          r.languages.map((l) => h(Text, {}, `${l.language} - ${l.fluency}`)),
        ),
        section(
          language === 'fr' ? 'Projets' : 'Projects',
          r.projects.map((p) =>
            h(
              View,
              { style: styles.entry },
              text(p.name, true),
              text(p.url),
              text(p.description),
              ...p.highlights.map((v) => text(`- ${v}`)),
            ),
          ),
        ),
      ),
    ),
  );
}
