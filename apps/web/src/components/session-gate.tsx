'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
export function SessionGate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const t = useTranslations('Session');
  const common = useTranslations('Common');
  useEffect(() => {
    if (session.data === null) router.replace('/connexion');
  }, [session.data, router]);
  if (session.isError)
    return (
      <main className="session-state">
        <h1>{t('error')}</h1>
        <p>{t('description')}</p>
        <Button onClick={() => void session.refetch()}>
          {common('retry')}
        </Button>
      </main>
    );
  if (!session.data)
    return (
      <main className="session-state" aria-busy="true">
        <span className="sr-only" role="status">
          {t('loading')}
        </span>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-5 w-80" />
        <Skeleton className="h-56 w-full max-w-3xl" />
      </main>
    );
  return children;
}
