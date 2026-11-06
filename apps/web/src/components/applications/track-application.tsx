'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
export function TrackApplication({
  matchId,
  applied,
}: {
  matchId: string;
  applied: boolean;
}) {
  const t = useTranslations('Applications'),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  async function track(submitted: boolean) {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      if (submitted) await apiClient.jobStatus(matchId, 'applied');
      else await apiClient.createApplication(matchId);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['applications'] }),
        client.invalidateQueries({ queryKey: ['jobs'] }),
        client.invalidateQueries({ queryKey: ['job', matchId] }),
      ]);
      setMessage(t('created'));
    } catch {
      setError(true);
      setMessage(t('saveError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-section application-track">
      <h2>{t('trackTitle')}</h2>
      <p className="profile-help">{t('trackHelp')}</p>
      <div className="profile-actions">
        <Button disabled={busy} variant="outline" onClick={() => track(false)}>
          {t('track')}
        </Button>
        <Button disabled={busy || applied} onClick={() => track(true)}>
          {t(applied ? 'alreadyApplied' : 'markApplied')}
        </Button>
        <Link href="/candidatures" className="job-link">
          {t('openBoard')}
        </Link>
      </div>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
    </section>
  );
}
