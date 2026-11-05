'use client';
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ImportProposal } from '@jobpilot/shared/llm';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function ResumeImport({
  onProposal,
}: {
  onProposal: (proposal: ImportProposal, title: string) => void;
}) {
  const t = useTranslations('AI');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || file.size > 5 * 1024 * 1024) throw new Error('size');
      return apiClient.importResume(file);
    },
    onSuccess: (proposal) => {
      onProposal(
        proposal,
        file?.name.replace(/\.pdf$/i, '').slice(0, 150) || t('importedTitle'),
      );
      setFile(null);
      form.current?.reset();
      setError('');
    },
    onError: (error) =>
      setError(
        t(
          error instanceof ApiClientError && error.code === 'LLM_NOT_CONFIGURED'
            ? 'notConfigured'
            : error instanceof ApiClientError &&
                error.code === 'LLM_BUDGET_EXCEEDED'
              ? 'budgetExceeded'
              : error instanceof ApiClientError && error.code.startsWith('PDF_')
                ? 'unreadable'
                : error instanceof ApiClientError &&
                    error.code === 'LLM_INVALID_OUTPUT'
                  ? 'invalidOutput'
                  : 'importError',
        ),
      ),
  });
  return (
    <section className="profile-editor">
      <h2>{t('importTitle')}</h2>
      <p className="profile-help">{t('importNotice')}</p>
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!file || file.size > 5 * 1024 * 1024) {
            setError(t('fileSize'));
            return;
          }
          mutation.mutate();
        }}
      >
        <div className="profile-field">
          <label htmlFor="resume-pdf">{t('pdfFile')}</label>
          <Input
            id="resume-pdf"
            type="file"
            accept="application/pdf,.pdf"
            disabled={mutation.isPending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button type="submit" disabled={!file || mutation.isPending}>
          {t(mutation.isPending ? 'importing' : 'propose')}
        </Button>
        {mutation.isPending && <p role="status">{t('importingNotice')}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
