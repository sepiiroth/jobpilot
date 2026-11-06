'use client';
import { useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ResumeEditor } from '../profile/resumes-page';
import { ResumePreview } from '../profile/resume-preview';
import { downloadBlob } from '../profile/form-parts';
import {
  generationParamsSchema,
  type GeneratedDocument,
  type GenerationParams,
} from '@jobpilot/shared/generation';
export function GeneratedDocuments({ matchId }: { matchId: string }) {
  const t = useTranslations('Generation');
  const client = useQueryClient();
  const resumes = useQuery({
    queryKey: ['resumes'],
    queryFn: apiClient.resumes,
  });
  const documents = useInfiniteQuery({
    queryKey: ['documents', matchId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.documents(matchId, pageParam ?? undefined),
    getNextPageParam: (page) => page.nextCursor,
  });
  const history = documents.data?.pages.flatMap((p) => p.items) ?? [];
  const [resumeId, setResumeId] = useState('');
  const [params, setParams] = useState<GenerationParams>(
    generationParamsSchema.parse({}),
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<GeneratedDocument | null>(null);
  const current = history.find((d) => d.id === selected?.id) ?? selected;
  const master = resumes.data?.find((r) => r.id === current?.resumeId);
  const options = resumes.data?.filter((r) => !r.isArchived) ?? [];
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['documents', matchId] });
  }
  return (
    <section
      className="profile-section generation-panel"
      aria-labelledby="generation-heading"
    >
      <h2 id="generation-heading">{t('title')}</h2>
      <p className="profile-help">{t('notice')}</p>
      <div className="profile-grid">
        <div className="profile-field">
          <label htmlFor="generation-resume">{t('master')}</label>
          <select
            id="generation-resume"
            disabled={pending}
            value={resumeId || options[0]?.id || ''}
            onChange={(e) => setResumeId(e.target.value)}
          >
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
        {(['tone', 'length', 'language'] as const).map((key) => (
          <div className="profile-field" key={key}>
            <label htmlFor={'generation-' + key}>{t(key)}</label>
            <select
              id={'generation-' + key}
              disabled={pending}
              value={params[key]}
              onChange={(e) =>
                setParams(
                  generationParamsSchema.parse({
                    ...params,
                    [key]: e.target.value,
                  }),
                )
              }
            >
              {(key === 'tone'
                ? ['formal', 'neutral', 'direct']
                : key === 'length'
                  ? ['short', 'medium', 'long']
                  : ['fr', 'en']
              ).map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {(resumes.isError || documents.isError) && (
        <p role="alert">{t('loadError')}</p>
      )}
      {!options.length && !resumes.isPending && <p>{t('noResume')}</p>}
      <Button
        disabled={pending || !options.length}
        onClick={async () => {
          setPending(true);
          setError('');
          try {
            // Separate measured calls keep each document's real token usage and cost attributable.
            for (const kind of ['resume', 'cover_letter'] as const) {
              const value = await apiClient.generateDocument(
                matchId,
                resumeId || options[0]!.id,
                kind,
                params,
              );
              setSelected(value);
              await refresh();
            }
          } catch (e) {
            setError(
              e instanceof ApiClientError && e.code === 'LLM_NOT_CONFIGURED'
                ? t('configure')
                : t('generateError'),
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {t(pending ? 'generating' : 'generate')}
      </Button>
      {pending && <p role="status">{t('wait')}</p>}
      {error && <p role="alert">{error}</p>}
      <h3>{t('history')}</h3>
      <div className="generation-history">
        {history.map((d) => (
          <Button
            key={d.id}
            variant={selected?.id === d.id ? 'secondary' : 'outline'}
            onClick={() => setSelected(d)}
          >
            {t(d.kind)} · {t('version', { version: d.version })} ·{' '}
            {new Intl.DateTimeFormat('fr-FR', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(d.createdAt))}
          </Button>
        ))}
      </div>
      {!history.length && <p className="profile-help">{t('empty')}</p>}
      {documents.hasNextPage && (
        <Button
          variant="outline"
          disabled={documents.isFetchingNextPage}
          onClick={() => void documents.fetchNextPage()}
        >
          {t('older')}
        </Button>
      )}
      {current && master && (
        <details>
          <summary>{t('compareMaster')}</summary>
          <ResumePreview data={master.data} />
        </details>
      )}
      {current && (
        <DocumentEditor
          key={
            current.id +
            ':' +
            current.sourceFingerprint +
            ':' +
            current.integrity.approved
          }
          value={current}
          onUpdated={async (d) => {
            setSelected(d);
            await refresh();
          }}
        />
      )}
    </section>
  );
}
function DocumentEditor({
  value,
  onUpdated,
}: {
  value: GeneratedDocument;
  onUpdated: (d: GeneratedDocument) => Promise<void>;
}) {
  const t = useTranslations('Generation');
  const [text, setText] = useState(
    value.content.kind === 'cover_letter' ? value.content.text : '',
  );
  const [checked, setChecked] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [resumeDirty, setResumeDirty] = useState(false);
  const dirty =
    resumeDirty ||
    (value.content.kind === 'cover_letter' && text !== value.content.text);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch {
      setError(t('actionError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="generation-document">
      <h3>
        {t(value.kind)} · {t('version', { version: value.version })}
      </h3>
      <p>
        {t('cost', {
          tokensIn: value.cost.tokensIn,
          tokensOut: value.cost.tokensOut,
          model:
            value.cost.provider === 'manual' ? t('manual') : value.cost.model,
        })}{' '}
        {value.cost.costUsd === null
          ? t('unpriced')
          : t('priced', { cost: value.cost.costUsd.toFixed(6) })}
      </p>
      {!!value.cost.uncertainAttempts && (
        <p role="status">
          {t('uncertainCost', { count: value.cost.uncertainAttempts })}
        </p>
      )}
      {value.integrity.sourceChanged && (
        <p className="generation-warning" role="alert">
          {t('sourceChanged')}
        </p>
      )}
      {value.integrity.blocked ? (
        <section className="generation-warning" aria-label={t('integrity')}>
          <h4>{t('integrity')}</h4>
          <p>{t('reviewHelp')}</p>
          {value.integrity.issues.map((i) => (
            <label className="generation-issue" key={i.id}>
              <input
                type="checkbox"
                checked={checked.includes(i.id)}
                onChange={(e) =>
                  setChecked((v) =>
                    e.target.checked
                      ? [...v, i.id]
                      : v.filter((id) => id !== i.id),
                  )
                }
              />
              <span>
                <strong>{t(i.code)}</strong> ·{' '}
                {t('section_' + i.path.split('.')[0])}
                <span className="generation-issue-value">{i.value}</span>
              </span>
            </label>
          ))}
          <label className="profile-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('confirm')}
          </label>
          <Button
            variant="outline"
            disabled={
              busy ||
              dirty ||
              !confirmed ||
              checked.length !== value.integrity.issues.length
            }
            onClick={() =>
              action(async () =>
                onUpdated(
                  await apiClient.reviewDocument(
                    value.id,
                    value.sourceFingerprint,
                    checked,
                  ),
                ),
              )
            }
          >
            {t('approve')}
          </Button>
        </section>
      ) : (
        <p role="status">
          {t(value.integrity.approved ? 'approved' : 'noIssues')}
        </p>
      )}
      {value.content.kind === 'resume' ? (
        <>
          <ResumePreview data={value.content.data} />
          <ResumeEditor
            onDirtyChange={setResumeDirty}
            record={null}
            initial={{
              title: t('resume'),
              isArchived: false,
              data: value.content.data,
            }}
            onDeleted={() => {}}
            onSaved={() => {}}
            saveDraft={async (draft) => {
              const next = await apiClient.editDocument(value.id, {
                kind: 'resume',
                data: draft.data,
              });
              await onUpdated(next);
              return { ...draft, id: next.id, embeddingStatus: 'pending' };
            }}
          />
        </>
      ) : (
        <div className="profile-field">
          <label htmlFor="document-letter">{t('letterText')}</label>
          <textarea
            id="document-letter"
            rows={16}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            disabled={busy || !dirty || !text.trim()}
            onClick={() =>
              action(async () =>
                onUpdated(
                  await apiClient.editDocument(value.id, {
                    kind: 'cover_letter',
                    text,
                  }),
                ),
              )
            }
          >
            {t('saveVersion')}
          </Button>
        </div>
      )}
      <div className="profile-actions">
        <Button
          disabled={busy || dirty || value.integrity.blocked}
          onClick={() =>
            action(async () => {
              downloadBlob({
                blob: await apiClient.documentPdf(value.id),
                filename: value.kind + '-v' + value.version + '.pdf',
              });
            })
          }
        >
          {t('exportPdf')}
        </Button>
        {value.kind === 'cover_letter' && (
          <Button
            variant="outline"
            disabled={busy || dirty || value.integrity.blocked}
            onClick={() =>
              action(async () => {
                await navigator.clipboard.writeText(
                  (await apiClient.documentText(value.id)).text,
                );
              })
            }
          >
            {t('copy')}
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
