'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
const reportSources = new Set([
  'adzuna',
  'greenhouse',
  'lever',
  'ashby',
  'email',
  'scoring',
  'embedding',
  'worker',
]);
function reportError(code: string) {
  if (code === 'SOURCE_NOT_CONFIGURED') return 'configuration';
  if (
    [
      'COLLECTION_OFFER_LIMIT',
      'COLLECTION_REQUEST_LIMIT',
      'COLLECTION_PAGE_LIMIT',
      'COLLECTION_TIME_LIMIT',
      'EMAIL_MESSAGE_LIMIT',
      'EMAIL_CACHE_LIMIT',
    ].includes(code)
  )
    return 'limit';
  if (code === 'SOURCE_NOT_AVAILABLE') return 'unavailable';
  if (code.startsWith('SCORING_')) return 'scoring';
  if (code === 'EMBEDDING_FAILED') return 'embedding';
  if (code === 'EMAIL_HOST_FORBIDDEN') return 'email_host';
  if (code === 'EMAIL_MESSAGE_TOO_LARGE') return 'email_size';
  if (['EMAIL_EXTRACTION_FAILED', 'EMAIL_EXTRACTION_UNCERTAIN'].includes(code))
    return 'email_extraction';
  if (code.startsWith('EMAIL_')) return 'email_connection';
  return 'source';
}
export function CollectionPanel() {
  const t = useTranslations('Collection');
  const [id, setId] = useState<string | undefined>();
  const [error, setError] = useState('');
  const run = useQuery({
    queryKey: ['collection', id ?? 'latest'],
    queryFn: () =>
      id ? apiClient.collection(id) : apiClient.latestCollection(),
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status)
        ? 3000
        : false,
  });
  const start = useMutation({
    mutationFn: apiClient.startCollection,
    onSuccess: (value) => {
      setId(value.id);
      setError('');
      void run.refetch();
    },
    onError: (e) =>
      setError(
        t(
          e instanceof ApiClientError && e.code === 'COLLECTION_COOLDOWN'
            ? 'cooldown'
            : e instanceof ApiClientError && e.code === 'COLLECTION_NO_SEARCHES'
              ? 'noSearches'
              : 'startError',
        ),
      ),
  });
  const active = !!run.data && ['queued', 'running'].includes(run.data.status);
  const stats = run.data?.stats;
  return (
    <section className="collection-panel" aria-labelledby="collection-heading">
      <div className="profile-toolbar">
        <div>
          <h2 id="collection-heading">{t('title')}</h2>
          <p className="profile-help">{t('description')}</p>
        </div>
        <Button
          disabled={start.isPending || active}
          onClick={() => start.mutate()}
        >
          {t(start.isPending ? 'starting' : active ? 'active' : 'start')}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {run.isError && <p role="alert">{t('loadError')}</p>}
      {run.data && stats && (
        <>
          <p role="status" aria-live="polite">
            {t(
              run.data.stage === 'scoring' && active
                ? 'scoring'
                : 'status_' + run.data.status,
            )}
          </p>
          <Progress
            value={
              stats.sourcesTotal
                ? (100 * stats.sourcesProcessed) / stats.sourcesTotal
                : 0
            }
            aria-label={t('progress')}
          />
          <dl className="collection-stats">
            {(
              [
                'sourcesProcessed',
                'found',
                'new',
                'duplicates',
                'embeddingsReady',
              ] as const
            ).map((key) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>
                  {key === 'sourcesProcessed'
                    ? `${stats[key]} / ${stats.sourcesTotal}`
                    : stats[key]}
                </dd>
              </div>
            ))}
          </dl>
          {!!run.data.errors.length && (
            <div className="profile-notice">
              <h3>{t('errors')}</h3>
              <ul>
                {run.data.errors.map((e, i) => (
                  <li key={i}>
                    {t(
                      reportSources.has(e.source)
                        ? 'source_' + e.source
                        : 'source_other',
                    )}{' '}
                    : {t('error_' + reportError(e.code))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
