import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Compass, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
export async function PlaceholderPage({
  section,
}: {
  section: 'offers' | 'resumes' | 'searches' | 'applications' | 'settings';
}) {
  const nav = await getTranslations('Nav');
  const t = await getTranslations('Placeholder');
  return (
    <section className="placeholder-page">
      <p className="eyebrow">{nav(section)}</p>
      <Compass
        className="placeholder-compass"
        size={42}
        strokeWidth={1.2}
        aria-hidden="true"
      />
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('back')}
        </Link>
      </Button>
    </section>
  );
}
