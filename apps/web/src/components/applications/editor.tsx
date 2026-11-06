'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  applicationFieldsSchema,
  applicationStatuses,
  localCalendarDate,
  type ApplicationRecord,
  type ApplicationFields,
} from '@jobpilot/shared/applications';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ResumePreview } from '@/components/profile/resume-preview';
import { downloadBlob } from '@/components/profile/form-parts';
export function ApplicationEditor({
  record,
  onSaved,
}: {
  record: ApplicationRecord;
  onSaved: (row: ApplicationRecord) => Promise<void>;
}) {
  const t = useTranslations('Applications');
  const [fields, setFields] = useState<ApplicationFields>({
    status: record.status,
    appliedAt: record.appliedAt,
    followUpAt: record.followUpAt,
    notes: record.notes,
    resumeDocId: record.resumeDocId,
    letterDocId: record.letterDocId,
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [conflict, setConflict] = useState(false);
  const documents = useInfiniteQuery({
    queryKey: ['application-documents', record.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.applicationDocuments(record.id, pageParam ?? undefined),
    getNextPageParam: (p) => p.nextCursor,
  });
  const options = documents.data?.pages.flatMap((p) => p.items) ?? [];
  function field<K extends keyof ApplicationFields>(
    key: K,
    value: ApplicationFields[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="application-editor">
      <p className="profile-help">{t('detailsHelp')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setMessage('');
          const parsed = applicationFieldsSchema.safeParse(fields);
          if (!parsed.success) {
            setMessage(t('validation'));
            return;
          }
          setBusy(true);
          try {
            await onSaved(
              await apiClient.updateApplication(
                record.id,
                record.revision,
                parsed.data,
              ),
            );
            toast.success(t('created'));
          } catch (error) {
            setConflict(
              error instanceof ApiClientError &&
                error.code === 'APPLICATION_CHANGED',
            );
            setMessage(
              error instanceof ApiClientError &&
                error.code === 'DOCUMENT_REVIEW_REQUIRED'
                ? t('documentReview')
                : error instanceof ApiClientError &&
                    error.code === 'APPLICATION_CHANGED'
                  ? t('conflict')
                  : t('saveError'),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="profile-grid">
          <label className="profile-field" htmlFor="application-edit-status">
            {t('status')}
            <select
              id="application-edit-status"
              value={fields.status}
              disabled={busy}
              onChange={(e) => {
                setFields((v) => ({
                  ...v,
                  status:
                    applicationStatuses.find((s) => s === e.target.value) ??
                    v.status,
                  appliedAt:
                    e.target.value === 'to_apply'
                      ? v.appliedAt
                      : (v.appliedAt ?? localCalendarDate()),
                }));
              }}
            >
              {applicationStatuses.map((s) => (
                <option key={s} value={s}>
                  {t('status_' + s)}
                </option>
              ))}
            </select>
          </label>
          <label className="profile-field" htmlFor="application-applied-at">
            {t('appliedAt')}
            <input
              id="application-applied-at"
              type="date"
              value={fields.appliedAt ?? ''}
              disabled={busy}
              onChange={(e) => field('appliedAt', e.target.value || null)}
            />
          </label>
          <label className="profile-field" htmlFor="application-follow-up">
            {t('followUp')}
            <input
              id="application-follow-up"
              type="date"
              value={fields.followUpAt ?? ''}
              disabled={busy}
              onChange={(e) => field('followUpAt', e.target.value || null)}
            />
          </label>
        </div>
        <label className="profile-field" htmlFor="application-notes">
          {t('notes')}
          <textarea
            id="application-notes"
            rows={5}
            maxLength={10000}
            value={fields.notes ?? ''}
            disabled={busy}
            onChange={(e) => field('notes', e.target.value || null)}
          />
        </label>
        <fieldset className="application-documents">
          <legend>{t('documents')}</legend>
          <p className="profile-help">{t('documentsHelp')}</p>
          {(['resume', 'cover_letter'] as const).map((kind) => {
            const key = kind === 'resume' ? 'resumeDocId' : 'letterDocId';
            const choices = options.filter((d) => d.kind === kind);
            return (
              <label
                className="profile-field"
                key={kind}
                htmlFor={'application-document-' + kind}
              >
                {t(kind)}
                <select
                  id={'application-document-' + kind}
                  value={fields[key] ?? ''}
                  disabled={busy || documents.isPending}
                  onChange={(e) => field(key, e.target.value || null)}
                >
                  <option value="">{t('noDocument')}</option>
                  {fields[key] &&
                    !choices.some((d) => d.id === fields[key]) && (
                      <option value={fields[key]}>{t('linkedVersion')}</option>
                    )}
                  {choices.map((d) => (
                    <option
                      value={d.id}
                      key={d.id}
                      disabled={d.blocked && d.id !== record[key]}
                    >
                      {d.resumeTitle} · {t('version', { version: d.version })}
                      {d.blocked ? ' · ' + t('documentBlocked') : ''}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {documents.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              disabled={documents.isFetchingNextPage}
              onClick={() => void documents.fetchNextPage()}
            >
              {t('olderDocuments')}
            </Button>
          )}
          {documents.isError && <p role="alert">{t('documentsError')}</p>}
        </fieldset>
        {message && <p role="alert">{message}</p>}
        <div className="profile-actions">
          <Button type="submit" disabled={busy || conflict}>
            {t(busy ? 'saving' : 'save')}
          </Button>
          {conflict && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setBusy(true);
                try {
                  await onSaved(await apiClient.application(record.id));
                } catch {
                  setMessage(t('loadError'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('reload')}
            </Button>
          )}
        </div>
      </form>
      <div className="profile-actions">
        {record.matchId && (
          <Link className="job-link" href={'/offres/' + record.matchId}>
            {t('openOffer')}
          </Link>
        )}
        <a
          className="job-link"
          href={record.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('openSource')}
        </a>
      </div>
      <details>
        <summary>{t('offerDescription')}</summary>
        <p className="job-description">{record.description}</p>
      </details>
      {record.resumeDocId && <LinkedDocument id={record.resumeDocId} />}{' '}
      {record.letterDocId && <LinkedDocument id={record.letterDocId} />}
      <p className="profile-help">{t('savedDocuments')}</p>
    </div>
  );
}
function LinkedDocument({ id }: { id: string }) {
  const t = useTranslations('Applications');
  const [open, setOpen] = useState(false),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const document = useQuery({
    queryKey: ['linked-document', id],
    queryFn: () => apiClient.document(id),
    enabled: open,
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('viewDocument')}</summary>
      {document.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : document.isError ? (
        <p role="alert">{t('documentsError')}</p>
      ) : (
        <>
          <h3>
            {t(document.data.kind)} ·{' '}
            {t('version', { version: document.data.version })}
          </h3>
          {document.data.content.kind === 'resume' ? (
            <ResumePreview data={document.data.content.data} />
          ) : (
            <p className="job-description">{document.data.content.text}</p>
          )}
          {document.data.integrity.blocked && (
            <p role="alert">{t('documentReview')}</p>
          )}
          <Button
            disabled={busy || document.data.integrity.blocked}
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                downloadBlob({
                  blob: await apiClient.documentPdf(id),
                  filename:
                    document.data.kind + '-v' + document.data.version + '.pdf',
                });
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('exportPdf')}
          </Button>
          {error && <p role="alert">{t('documentsError')}</p>}
        </>
      )}
    </details>
  );
}
