import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Providers } from '@/components/providers';
import './globals.css';

const appName = process.env.APP_NAME || 'JobPilot';
export const metadata: Metadata = {
  title: { default: appName, template: '%s · ' + appName },
  description: 'Votre recherche d’emploi, organisée à votre rythme.',
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get('x-nonce') ?? '';
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale="fr" messages={await getMessages()}>
          <Providers nonce={nonce}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
