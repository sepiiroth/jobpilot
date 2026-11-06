import { createElement as h } from 'react';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
export function renderLetterPdf(text: string, language: 'fr' | 'en') {
  return renderToBuffer(
    h(
      Document,
      {
        title: language === 'fr' ? 'Lettre de motivation' : 'Cover letter',
        language,
      },
      h(
        Page,
        {
          size: 'A4',
          style: {
            padding: 48,
            fontFamily: 'Helvetica',
            fontSize: 11,
            lineHeight: 1.6,
            color: '#18212d',
          },
        },
        ...text
          .split(/\n\s*\n/)
          .map((p) => h(Text, { style: { marginBottom: 12 } }, p)),
      ),
    ),
  );
}
