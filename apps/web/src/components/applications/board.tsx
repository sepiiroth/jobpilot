'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  type DragOverEvent,
  type DragEndEvent,
  DragDropProvider,
  useDraggable,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
} from '@dnd-kit/react';
import { Accessibility } from '@dnd-kit/dom';
import {
  applicationStatuses,
  isFollowUpDue,
  localCalendarDate,
  type ApplicationRecord,
  type ApplicationStatus,
} from '@jobpilot/shared/applications';
import { applicationStatusSchema } from '@jobpilot/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ApplicationEditor } from './editor';
export function ApplicationsBoard() {
  const t = useTranslations('Applications'),
    client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['applications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiClient.applications(pageParam ?? undefined),
    getNextPageParam: (p) => p.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [selected, setSelected] = useState<ApplicationRecord | null>(null),
    [dueOnly, setDueOnly] = useState(false),
    [today, setToday] = useState(localCalendarDate);
  useEffect(() => {
    const timer = setInterval(() => setToday(localCalendarDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  async function move(row: ApplicationRecord, status: ApplicationStatus) {
    if (busy || row.status === status) return;
    setBusy(true);
    setError('');
    setMessage(t('saving'));
    try {
      await apiClient.moveApplication(row.id, row.revision, status);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['applications'] }),
        client.invalidateQueries({ queryKey: ['jobs'] }),
      ]);
      setMessage(
        t('moved', { title: row.title, status: t('status_' + status) }),
      );
      requestAnimationFrame(() => {
        const handle = document.querySelector<HTMLButtonElement>(
          `[data-application-handle="${row.id}"]`,
        );
        if (handle) handle.focus();
        else document.getElementById('application-column-' + status)?.focus();
      });
    } catch (e) {
      setMessage('');
      setError(
        e instanceof ApiClientError && e.code === 'APPLICATION_CHANGED'
          ? t('conflict')
          : t('saveError'),
      );
      await client.invalidateQueries({ queryKey: ['applications'] });
    } finally {
      setBusy(false);
    }
  }
  const visible = rows.filter((r) => !dueOnly || isFollowUpDue(r, today));
  return (
    <div className="workspace-page applications-page">
      <header className="page-heading">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      <div className="profile-toolbar">
        <label className="profile-check">
          <input
            type="checkbox"
            checked={dueOnly}
            onChange={(e) => setDueOnly(e.target.checked)}
          />
          {t('dueOnly')}
        </label>
        <Link href="/offres" className="job-link">
          {t('chooseOffer')}
        </Link>
      </div>
      <p id="application-drag-help" className="profile-help">
        {t('dragHelp')}
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {error && <p role="alert">{error}</p>}
      {query.isError && rows.length > 0 && <p role="alert">{t('loadError')}</p>}
      {query.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : query.isError && !rows.length ? (
        <p role="alert">{t('loadError')}</p>
      ) : (
        <>
          {!rows.length && <p className="profile-notice">{t('empty')}</p>}
          <DragDropProvider
            sensors={[
              PointerSensor,
              KeyboardSensor.configure({ offset: { x: 288, y: 80 } }),
            ]}
            plugins={(defaults) => [
              ...defaults.filter((p) => p !== Accessibility),
              Accessibility.configure({
                screenReaderInstructions: { draggable: t('dragHelp') },
                announcements: {
                  dragstart: () => t('dragStart'),
                  dragover: ({ operation }: DragOverEvent) => {
                    const status = applicationStatusSchema.safeParse(
                      operation.target?.id,
                    );
                    return status.success
                      ? t('dragOver', { status: t('status_' + status.data) })
                      : undefined;
                  },
                  dragend: (event: DragEndEvent) =>
                    event.canceled || !event.operation.target
                      ? t('dragCanceled')
                      : t('dragDropped'),
                },
              }),
            ]}
            onDragEnd={(event) => {
              if (event.canceled) return;
              const row = rows.find((r) => r.id === event.operation.source?.id),
                status = applicationStatusSchema.safeParse(
                  event.operation.target?.id,
                );
              if (row && status.success) void move(row, status.data);
            }}
          >
            <div
              className="application-board"
              aria-label={t('board')}
              aria-busy={busy}
            >
              {applicationStatuses.map((status) => (
                <Column
                  key={status}
                  status={status}
                  count={visible.filter((r) => r.status === status).length}
                >
                  {visible
                    .filter((r) => r.status === status)
                    .map((row) => (
                      <Card
                        key={row.id}
                        row={row}
                        busy={busy}
                        due={isFollowUpDue(row, today)}
                        onEdit={() => setSelected(row)}
                        onMove={(s) => move(row, s)}
                      />
                    ))}
                </Column>
              ))}
            </div>
          </DragDropProvider>
          {query.hasNextPage && (
            <p className="profile-help">{t('loadedNotice')}</p>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('older')}
            </Button>
          )}
          {query.isFetchNextPageError && <p role="alert">{t('loadError')}</p>}
        </>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="application-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{selected?.title ?? t('details')}</DialogTitle>
            <DialogDescription>
              {selected?.company ?? t('detailsHelp')}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <ApplicationEditor
              key={selected.id + ':' + selected.revision}
              record={selected}
              onSaved={async (row) => {
                setSelected(row);
                await Promise.all([
                  client.invalidateQueries({ queryKey: ['applications'] }),
                  client.invalidateQueries({ queryKey: ['jobs'] }),
                ]);
              }}
            />
          )}
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="application-dialog-close"
              aria-label={t('close')}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Column({
  status,
  count,
  children,
}: {
  status: ApplicationStatus;
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations('Applications');
  const { ref, isDropTarget } = useDroppable({ id: status });
  return (
    <section
      ref={ref}
      className={'application-column' + (isDropTarget ? ' is-drop-target' : '')}
      data-status={status}
      aria-labelledby={'application-column-' + status}
    >
      <h2 tabIndex={-1} id={'application-column-' + status}>
        {t('status_' + status)}{' '}
        <span aria-label={t('shownCount', { count })}>{count}</span>
      </h2>
      <div className="application-cards">
        {children}
        {count === 0 && <p className="profile-help">{t('emptyColumn')}</p>}
      </div>
    </section>
  );
}
function Card({
  row,
  busy,
  due,
  onEdit,
  onMove,
}: {
  row: ApplicationRecord;
  busy: boolean;
  due: boolean;
  onEdit: () => void;
  onMove: (status: ApplicationStatus) => Promise<void>;
}) {
  const t = useTranslations('Applications');
  const { ref, handleRef, isDragging } = useDraggable({
    id: row.id,
    disabled: busy,
  });
  return (
    <article
      ref={ref}
      className={'application-card' + (isDragging ? ' is-dragging' : '')}
      data-application-id={row.id}
    >
      <div className="application-card-heading">
        <h3>{row.title}</h3>
        <button
          ref={handleRef}
          type="button"
          disabled={busy}
          className="application-drag-handle"
          data-application-handle={row.id}
          aria-describedby="application-drag-help"
          aria-label={t('dragLabel', { title: row.title })}
        >
          ⠿
        </button>
      </div>
      <p>{row.company}</p>
      {due && <span className="application-due">{t('due')}</span>}
      {row.followUpAt && (
        <p>
          {t('followUp')}:{' '}
          <time dateTime={row.followUpAt}>
            {new Intl.DateTimeFormat('fr-FR').format(
              new Date(row.followUpAt + 'T12:00:00'),
            )}
          </time>
        </p>
      )}
      <label
        className="application-status-label"
        htmlFor={'application-status-' + row.id}
      >
        {t('moveTo')}
      </label>
      <select
        id={'application-status-' + row.id}
        value={row.status}
        disabled={busy}
        onChange={(e) =>
          void onMove(applicationStatusSchema.parse(e.target.value))
        }
      >
        {applicationStatuses.map((s) => (
          <option key={s} value={s}>
            {t('status_' + s)}
          </option>
        ))}
      </select>
      <Button variant="outline" disabled={busy} onClick={onEdit}>
        {t('edit')}
      </Button>
      {row.matchId && (
        <Link href={'/offres/' + row.matchId} className="job-link">
          {t('openOffer')}
        </Link>
      )}
    </article>
  );
}
