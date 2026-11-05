'use client';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import type { FieldValues, FieldPath, UseFormReturn } from 'react-hook-form';
export function Field<T extends FieldValues>({
  form,
  name,
  label,
  optional = false,
  type = 'text',
  multiline = false,
}: {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  optional?: boolean;
  type?: string;
  multiline?: boolean;
}) {
  const id = name.replaceAll('.', '-');
  const registration = form.register(name, {
    setValueAs: (v) => (optional && v === '' ? undefined : v),
  });
  return (
    <div className="profile-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={4} {...registration} />
      ) : (
        <Input id={id} type={type} {...registration} />
      )}
    </div>
  );
}
export function DeleteButton({
  onDelete,
  disabled = false,
}: {
  onDelete: () => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations('Profile');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          {t('delete')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert">{t('deleteError')}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t('cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(false);
              try {
                await onDelete();
                setOpen(false);
              } catch {
                setError(true);
              } finally {
                setPending(false);
              }
            }}
          >
            {t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function ProfileHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="profile-heading">
      <div>
        <p className="eyebrow">JOBPILOT</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
export function useProfileMessage() {
  const t = useTranslations('Profile');
  return (error: unknown) =>
    t(
      error instanceof ApiClientError && error.code === 'RESUME_IN_USE'
        ? 'resumeInUse'
        : error instanceof ApiClientError && error.status === 409
          ? 'conflict'
          : 'saveError',
    );
}
export function downloadBlob({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function previewPdf(pendingBlob: Promise<Blob>) {
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;
  try {
    const blob = await pendingBlob;
    if (!tab) {
      downloadBlob({ blob, filename: 'cv.pdf' });
      return;
    }
    const url = URL.createObjectURL(blob);
    tab.location.replace(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
