'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  useForm,
  useFieldArray,
  Controller,
  type FieldPath,
} from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  resumeInputSchema,
  type ResumeInput,
  type ResumeRecord,
} from '@jobpilot/shared/profile';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Field,
  DeleteButton,
  ProfileHeader,
  useProfileMessage,
  downloadBlob,
  previewPdf,
} from './form-parts';
import { ResumeImport } from './resume-import';
import { ResumePreview } from './resume-preview';
const empty = (): ResumeInput => ({
  title: '',
  isArchived: false,
  data: {
    basics: { name: '', profiles: [] },
    work: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
  },
});
function cleanDraft(value: ResumeInput) {
  const draft = structuredClone(value);
  const location = draft.data.basics.location;
  if (location && !location.city && !location.postalCode && !location.country)
    delete draft.data.basics.location;
  return draft;
}
export function ResumesPage() {
  const t = useTranslations('Profile');
  const ai = useTranslations('AI');
  const [draft, setDraft] = useState<ResumeInput | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draftVersion, setDraftVersion] = useState(0);
  const query = useQuery({
    queryKey: ['resumes'],
    queryFn: apiClient.resumes,
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.some((v) => v.embeddingStatus === 'pending') ? 3000 : false,
  });
  const [selected, setSelected] = useState<ResumeRecord | null | undefined>(
    undefined,
  );
  return (
    <section className="profile-page">
      <ProfileHeader
        title={t('resumesTitle')}
        description={t('resumesDescription')}
      >
        <Button
          onClick={() => {
            setDraft(null);
            setWarnings([]);
            setDraftVersion((v) => v + 1);
            setSelected(null);
          }}
        >
          {t('newResume')}
        </Button>
      </ProfileHeader>
      <ResumeImport
        onProposal={(proposal, title) => {
          setDraft({ title, data: proposal.data, isArchived: false });
          setWarnings(proposal.warnings);
          setDraftVersion((v) => v + 1);
          setSelected(null);
        }}
      />
      {draft && selected === null && (
        <aside className="profile-notice">
          <p>{ai('reviewNotice')}</p>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
      {query.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : query.isError ? (
        <p role="alert">
          {t('loadError')}{' '}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </p>
      ) : (
        <div className="profile-records">
          {query.data.map((record) => (
            <Button
              key={record.id}
              variant={selected?.id === record.id ? 'default' : 'outline'}
              onClick={() => setSelected(record)}
            >
              {record.title}
              {record.isArchived ? ` (${t('archived')})` : ''}
            </Button>
          ))}
          {!query.data.length && <p>{t('noResumes')}</p>}
        </div>
      )}
      {selected !== undefined && (
        <ResumeEditor
          key={selected?.id ?? 'draft-' + draftVersion}
          record={
            selected
              ? (query.data?.find((v) => v.id === selected.id) ?? selected)
              : null
          }
          initial={selected ? null : draft}
          onSaved={(value) => {
            setDraft(null);
            setWarnings([]);
            setSelected(value);
          }}
          onDeleted={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
export function ResumeEditor({
  record,
  initial,
  onSaved,
  onDeleted,
  saveDraft,
  onDirtyChange,
}: {
  record: ResumeRecord | null;
  initial: ResumeInput | null;
  onSaved: (v: ResumeRecord) => void;
  onDeleted: () => void;
  saveDraft?: (value: ResumeInput) => Promise<ResumeRecord>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations('Profile');
  const ai = useTranslations('AI');
  const [reviewed, setReviewed] = useState(false);
  const client = useQueryClient();
  const errorMessage = useProfileMessage();
  const form = useForm<ResumeInput>({
    defaultValues: record
      ? {
          title: record.title,
          data: record.data,
          isArchived: record.isArchived,
        }
      : (initial ?? empty()),
  });
  useEffect(() => {
    onDirtyChange?.(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);
  const work = useFieldArray({ control: form.control, name: 'data.work' });
  const education = useFieldArray({
    control: form.control,
    name: 'data.education',
  });
  const skills = useFieldArray({ control: form.control, name: 'data.skills' });
  const languages = useFieldArray({
    control: form.control,
    name: 'data.languages',
  });
  const projects = useFieldArray({
    control: form.control,
    name: 'data.projects',
  });
  const profiles = useFieldArray({
    control: form.control,
    name: 'data.basics.profiles',
  });
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const mutation = useMutation({
    mutationFn: (value: ResumeInput) =>
      saveDraft ? saveDraft(value) : apiClient.saveResume(record?.id, value),
    onSuccess: async (value) => {
      form.reset({
        title: value.title,
        data: value.data,
        isArchived: value.isArchived,
      });
      onSaved(value);
      toast.success(t('saved'));
      await client.invalidateQueries({ queryKey: ['resumes'] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const field = (
    name: FieldPath<ResumeInput>,
    label: string,
    optional = false,
    multiline = false,
  ) => (
    <Field
      form={form}
      name={name}
      label={t(label)}
      optional={optional}
      multiline={multiline}
    />
  );
  const lines = (name: FieldPath<ResumeInput>, label: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field: value }) => (
        <div className="profile-field">
          <label htmlFor={name}>{t(label)}</label>
          <textarea
            id={name}
            rows={3}
            value={Array.isArray(value.value) ? value.value.join('\n') : ''}
            onChange={(e) => value.onChange(e.target.value.split('\n'))}
          />
        </div>
      )}
    />
  );
  const parsedPreview = resumeInputSchema.safeParse(cleanDraft(form.watch()));
  return (
    <div className="profile-editor">
      <div className="profile-toolbar">
        <h2>
          {saveDraft ? t('edit') : record ? record.title : t('newResume')}
        </h2>
        <Button variant="outline" onClick={() => setPreview(!preview)}>
          {preview ? t('edit') : t('preview')}
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {preview ? (
        parsedPreview.success ? (
          <ResumePreview data={parsedPreview.data.data} />
        ) : (
          <p role="alert">{t('validation')}</p>
        )
      ) : (
        <form
          onSubmit={form.handleSubmit((value) => {
            const parsed = resumeInputSchema.safeParse(cleanDraft(value));
            if (!parsed.success) {
              setMessage(t('validation'));
              return;
            }
            setMessage('');
            mutation.mutate(parsed.data);
          })}
        >
          <fieldset>
            <legend>{t('identity')}</legend>
            <div className="profile-grid">
              {!saveDraft && field('title', 'resumeName')}
              {field('data.basics.name', 'fullName')}
              {field('data.basics.label', 'headline', true)}
              {field('data.basics.email', 'email', true)}
              {field('data.basics.phone', 'phone', true)}
              {field('data.basics.url', 'website', true)}
            </div>
            {field('data.basics.summary', 'summary', true, true)}
            {!saveDraft && (
              <label className="profile-check">
                <input type="checkbox" {...form.register('isArchived')} />
                {t('archived')}
              </label>
            )}
          </fieldset>
          <fieldset>
            <legend>{t('location')}</legend>
            <div className="profile-grid">
              {field('data.basics.location.city', 'city')}
              {field('data.basics.location.postalCode', 'postalCode', true)}
              {field('data.basics.location.country', 'country')}
            </div>
            <p className="profile-help">{t('locationHelp')}</p>
          </fieldset>
          <fieldset>
            <legend>{t('work')}</legend>
            {work.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                <div className="profile-grid">
                  {field(`data.work.${i}.name`, 'company')}
                  {field(`data.work.${i}.position`, 'position')}
                  {field(`data.work.${i}.startDate`, 'startDate')}
                  {field(`data.work.${i}.endDate`, 'endDate', true)}
                  {field(`data.work.${i}.url`, 'website', true)}
                </div>
                {field(`data.work.${i}.summary`, 'summary', true, true)}
                {lines(`data.work.${i}.highlights`, 'highlights')}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => work.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                work.append({
                  name: '',
                  position: '',
                  startDate: '',
                  highlights: [],
                })
              }
            >
              {t('addWork')}
            </Button>
          </fieldset>
          <fieldset>
            <legend>{t('education')}</legend>
            {education.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                <div className="profile-grid">
                  {field(`data.education.${i}.institution`, 'institution')}
                  {field(`data.education.${i}.area`, 'area')}
                  {field(`data.education.${i}.studyType`, 'degree')}
                  {field(`data.education.${i}.startDate`, 'startDate', true)}
                  {field(`data.education.${i}.endDate`, 'endDate', true)}
                </div>
                {lines(`data.education.${i}.courses`, 'courses')}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => education.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                education.append({
                  institution: '',
                  area: '',
                  studyType: '',
                  courses: [],
                })
              }
            >
              {t('addEducation')}
            </Button>
          </fieldset>
          <fieldset>
            <legend>{t('skills')}</legend>
            {skills.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                <div className="profile-grid">
                  {field(`data.skills.${i}.name`, 'skill')}
                  {field(`data.skills.${i}.level`, 'level', true)}
                </div>
                {lines(`data.skills.${i}.keywords`, 'keywords')}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => skills.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => skills.append({ name: '', keywords: [] })}
            >
              {t('addSkill')}
            </Button>
          </fieldset>
          <fieldset>
            <legend>{t('languages')}</legend>
            {languages.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                <div className="profile-grid">
                  {field(`data.languages.${i}.language`, 'language')}
                  {field(`data.languages.${i}.fluency`, 'level')}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => languages.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => languages.append({ language: '', fluency: '' })}
            >
              {t('addLanguage')}
            </Button>
          </fieldset>
          <fieldset>
            <legend>{t('projects')}</legend>
            {projects.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                {field(`data.projects.${i}.name`, 'project')}
                {field(`data.projects.${i}.description`, 'summary', true, true)}
                {field(`data.projects.${i}.url`, 'website', true)}
                {lines(`data.projects.${i}.highlights`, 'highlights')}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => projects.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => projects.append({ name: '', highlights: [] })}
            >
              {t('addProject')}
            </Button>
          </fieldset>
          <fieldset>
            <legend>{t('links')}</legend>
            {profiles.fields.map((v, i) => (
              <div className="profile-entry" key={v.id}>
                <div className="profile-grid">
                  {field(`data.basics.profiles.${i}.network`, 'network')}
                  {field(`data.basics.profiles.${i}.username`, 'username')}
                  {field(`data.basics.profiles.${i}.url`, 'website')}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => profiles.remove(i)}
                >
                  {t('removeEntry')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                profiles.append({ network: '', username: '', url: '' })
              }
            >
              {t('addLink')}
            </Button>
          </fieldset>
          {initial && (
            <label className="profile-check">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {ai('reviewed')}
            </label>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending || (!!initial && !reviewed)}
          >
            {t(mutation.isPending ? 'saving' : 'save')}
          </Button>
        </form>
      )}
      {record && (
        <div className="profile-actions">
          <Button
            variant="outline"
            disabled={downloading || form.formState.isDirty}
            onClick={async () => {
              setDownloading(true);
              try {
                downloadBlob({
                  blob: await apiClient.resumePdf(record.id),
                  filename: 'cv.pdf',
                });
              } catch (error) {
                setMessage(errorMessage(error));
              } finally {
                setDownloading(false);
              }
            }}
          >
            {t('exportPdf')}
          </Button>
          <Button
            variant="outline"
            disabled={downloading || form.formState.isDirty}
            onClick={async () => {
              setDownloading(true);
              try {
                await previewPdf(apiClient.resumePdf(record.id));
              } catch (error) {
                setMessage(errorMessage(error));
              } finally {
                setDownloading(false);
              }
            }}
          >
            {t('viewPdf')}
          </Button>
          <p role="status">{ai('embedding_' + record.embeddingStatus)}</p>
          <Button
            variant="outline"
            disabled={downloading || mutation.isPending}
            onClick={async () => {
              setDownloading(true);
              try {
                onSaved(await apiClient.reindexResume(record.id));
                await client.invalidateQueries({ queryKey: ['resumes'] });
              } catch (error) {
                setMessage(errorMessage(error));
              } finally {
                setDownloading(false);
              }
            }}
          >
            {ai('retryEmbedding')}
          </Button>
          <DeleteButton
            onDelete={async () => {
              await apiClient.deleteResume(record.id);
              await client.invalidateQueries({ queryKey: ['resumes'] });
              onDeleted();
            }}
          />
          <p className="profile-help">{t('exportSaved')}</p>
        </div>
      )}
    </div>
  );
}
