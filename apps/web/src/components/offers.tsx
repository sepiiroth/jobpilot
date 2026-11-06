'use client';
import { GeneratedDocuments } from './generation/documents';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import type { JobRecord, JobQuery } from '@jobpilot/shared/jobs';
function Score({ job }: { job: JobRecord }) {
  const t = useTranslations('Jobs');
  return (
    <span>
      {job.score !== null ? `${job.score} / 100` : t('state_' + job.state)}
    </span>
  );
}
export function OffersList() {
  const t = useTranslations('Jobs');
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(1);
  const criteria = {
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
    page,
  } as JobQuery;
  const jobs = useQuery({
    queryKey: ['jobs', criteria],
    queryFn: () => apiClient.jobs(criteria),
  });
  const searches = useQuery({
    queryKey: ['searches'],
    queryFn: apiClient.searches,
  });
  const change = (key: string, value: string) => {
    setFilters((v) => ({ ...v, [key]: value }));
    setPage(1);
  };
  return (
    <div className="workspace-page">
      <header className="page-heading">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      <form className="jobs-filters" onSubmit={(e) => e.preventDefault()}>
        <label>
          {t('search')}
          <select
            value={filters.searchId ?? ''}
            onChange={(e) => change('searchId', e.target.value)}
          >
            <option value="">{t('all')}</option>
            {searches.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('source')}
          <select
            value={filters.source ?? ''}
            onChange={(e) => change('source', e.target.value)}
          >
            <option value="">{t('all')}</option>
            {['adzuna', 'greenhouse', 'lever', 'ashby', 'email'].map((s) => (
              <option key={s} value={s}>
                {t('source_' + s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('status')}
          <select
            value={filters.status ?? ''}
            onChange={(e) => change('status', e.target.value)}
          >
            <option value="">{t('visible')}</option>
            {['new', 'interesting', 'ignored', 'applied'].map((s) => (
              <option key={s} value={s}>
                {t('status_' + s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('minScore')}
          <Input
            type="number"
            min={0}
            max={100}
            value={filters.minScore ?? ''}
            onChange={(e) => {
              if (
                e.target.value === '' ||
                (+e.target.value >= 0 && +e.target.value <= 100)
              )
                change('minScore', e.target.value);
            }}
          />
        </label>
        <label>
          {t('from')}
          <Input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => change('from', e.target.value)}
          />
        </label>
        <label>
          {t('to')}
          <Input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => change('to', e.target.value)}
          />
        </label>
      </form>
      {jobs.isError && <p role="alert">{t('loadError')}</p>}
      {jobs.isPending && <p role="status">{t('loading')}</p>}
      {jobs.data && (
        <>
          <p role="status">{t('count', { count: jobs.data.total })}</p>
          {!jobs.data.items.length ? (
            <div className="profile-notice">{t('empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'offer',
                    'search',
                    'source',
                    'added',
                    'score',
                    'status',
                  ].map((k) => (
                    <TableHead key={k}>{t(k)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.data.items.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link className="job-link" href={'/offres/' + job.id}>
                        {job.title}
                      </Link>
                      <div>{job.company}</div>
                      <small>
                        {job.location.city} ·{' '}
                        {job.location.country === 'ZZ'
                          ? t('unknown')
                          : job.location.country}
                      </small>
                    </TableCell>
                    <TableCell>{job.searchName}</TableCell>
                    <TableCell>{t('source_' + job.source)}</TableCell>
                    <TableCell>
                      {new Intl.DateTimeFormat('fr-FR').format(
                        new Date(job.createdAt),
                      )}
                    </TableCell>
                    <TableCell>
                      <Score job={job} />
                    </TableCell>
                    <TableCell>{t('status_' + job.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <nav className="profile-toolbar" aria-label={t('pagination')}>
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('previous')}
            </Button>
            <span>{t('page', { page })}</span>
            <Button
              variant="outline"
              disabled={page * jobs.data.pageSize >= jobs.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('next')}
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
export function OfferDetail({ id }: { id: string }) {
  const t = useTranslations('Jobs'),
    client = useQueryClient();
  const [error, setError] = useState('');
  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => apiClient.job(id),
  });
  const update = useMutation({
    mutationFn: (status: 'new' | 'interesting' | 'ignored') =>
      apiClient.jobStatus(id, status),
    onSuccess: async (value) => {
      setError('');
      client.setQueryData(['job', id], value);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['jobs'] }),
        client.invalidateQueries({ queryKey: ['jobs-summary'] }),
      ]);
    },
    onError: () => setError(t('saveError')),
  });
  if (job.isPending) return <p role="status">{t('loading')}</p>;
  if (job.isError || !job.data) return <p role="alert">{t('loadError')}</p>;
  const value = job.data;
  return (
    <article className="workspace-page job-detail">
      <Link className="job-link" href="/offres">
        {t('back')}
      </Link>
      <header className="page-heading">
        <p className="eyebrow">
          {value.company} · {value.searchName}
        </p>
        <h1>{value.title}</h1>
        <p>
          {value.location.city} · {t('source_' + value.source)} ·{' '}
          {t('status_' + value.status)}
        </p>
      </header>
      <div className="profile-toolbar">
        <strong>
          <Score job={value} />
        </strong>
        <div className="job-actions">
          <Button
            variant="outline"
            disabled={update.isPending || value.status === 'interesting'}
            onClick={() => update.mutate('interesting')}
          >
            {t('interesting')}
          </Button>
          <Button
            variant="outline"
            disabled={update.isPending || value.status === 'ignored'}
            onClick={() => update.mutate('ignored')}
          >
            {t('ignore')}
          </Button>
          {value.status === 'ignored' && (
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate('new')}
            >
              {t('restore')}
            </Button>
          )}
          <a
            className="job-link"
            href={value.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('openSource')}
          </a>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!!value.notes.length && (
        <section className="profile-notice">
          <h2>{t('reservations')}</h2>
          <ul>
            {value.notes.map((note) => (
              <li key={note}>{t('note_' + note)}</li>
            ))}
          </ul>
        </section>
      )}
      <dl className="job-facts">
        <div>
          <dt>{t('contract')}</dt>
          <dd>{t('contract_' + value.contractType)}</dd>
        </div>
        <div>
          <dt>{t('remote')}</dt>
          <dd>{t('remote_' + value.remote)}</dd>
        </div>
        <div>
          <dt>{t('salary')}</dt>
          <dd>
            {value.salaryMin === null && value.salaryMax === null
              ? t('unknown')
              : [value.salaryMin ?? '—', value.salaryMax ?? '—'].join(' – ') +
                ' ' +
                (value.salaryCurrency ?? '')}
          </dd>
        </div>
        <div>
          <dt>{t('published')}</dt>
          <dd>
            {value.publishedAt
              ? new Intl.DateTimeFormat('fr-FR').format(
                  new Date(value.publishedAt),
                )
              : t('unknown')}
          </dd>
        </div>
      </dl>
      <section className="profile-section">
        <h2>{t('analysis')}</h2>
        <p className="profile-help">{t('analysisNotice')}</p>
        {value.analysis ? (
          <div className="job-analysis">
            {(['strengths', 'concerns', 'missingSkills'] as const).map(
              (key) => (
                <section key={key}>
                  <h3>{t(key)}</h3>
                  {value.analysis![key].length ? (
                    <ul>
                      {value.analysis![key].map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t('noneReported')}</p>
                  )}
                </section>
              ),
            )}
          </div>
        ) : (
          <p>{t('state_' + value.state)}</p>
        )}
      </section>
      <GeneratedDocuments matchId={value.id} />
      <section className="profile-section">
        <h2>{t('descriptionHeading')}</h2>
        <p className="job-description">{value.description}</p>
      </section>
    </article>
  );
}
export function OffersSummary() {
  const t = useTranslations('Jobs');
  const summary = useQuery({
    queryKey: ['jobs-summary'],
    queryFn: apiClient.jobsSummary,
    refetchInterval: 3000,
  });
  if (!summary.data)
    return summary.isError ? <p role="alert">{t('loadError')}</p> : null;
  return (
    <section className="collection-panel" aria-labelledby="matches-heading">
      <div className="profile-toolbar">
        <h2 id="matches-heading">{t('summary')}</h2>
        <Link className="job-link" href="/offres">
          {t('seeAll')}
        </Link>
      </div>
      <dl className="collection-stats">
        {(['newOffers', 'matchedOffers', 'analyzed'] as const).map((key) => (
          <div key={key}>
            <dt>{t(key)}</dt>
            <dd>{summary.data[key]}</dd>
          </div>
        ))}
      </dl>
      {summary.data.best.length ? (
        <ol className="job-best">
          {summary.data.best.map((job) => (
            <li key={job.id}>
              <Link className="job-link" href={'/offres/' + job.id}>
                {job.title}
              </Link>
              <span>
                {job.company} · {job.searchName} · <Score job={job} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="profile-help">{t('summaryEmpty')}</p>
      )}
    </section>
  );
}
