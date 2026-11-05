'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  profileSettingsSchema,
  companyInputSchema,
  secretKindSchema,
  type ProfileSettings,
  type CompanyInput,
  type CompanyRecord,
  type SecretKind,
} from '@jobpilot/shared/profile';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  DeleteButton,
  ProfileHeader,
  useProfileMessage,
} from './form-parts';
export function SettingsPage() {
  const t = useTranslations('Profile');
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: apiClient.settings,
  });
  return (
    <section className="profile-page">
      <ProfileHeader
        title={t('settingsTitle')}
        description={t('settingsDescription')}
      />
      <p className="profile-notice">{t('privacyNotice')}</p>
      {settings.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : settings.isError ? (
        <p role="alert">
          {t('loadError')}
          <Button variant="outline" onClick={() => void settings.refetch()}>
            {t('retry')}
          </Button>
        </p>
      ) : (
        <SettingsEditor value={settings.data} />
      )}
      <SecretEditor />
      <CompaniesEditor />
    </section>
  );
}
function SettingsEditor({ value }: { value: ProfileSettings }) {
  const t = useTranslations('Profile');
  const form = useForm<ProfileSettings>({ defaultValues: value });
  const queryClient = useQueryClient();
  const describeError = useProfileMessage();
  const [message, setMessage] = useState('');
  const [imapEnabled, setImapEnabled] = useState(value.imap !== null);
  const mutation = useMutation({
    mutationFn: apiClient.saveSettings,
    onSuccess: async (data) => {
      form.reset(data);
      toast.success(t('saved'));
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => setMessage(describeError(error)),
  });
  return (
    <div className="profile-editor">
      <form
        onSubmit={form.handleSubmit((input) => {
          const parsed = profileSettingsSchema.safeParse({
            ...input,
            imap: imapEnabled ? input.imap : null,
          });
          if (!parsed.success) {
            setMessage(t('validation'));
            return;
          }
          mutation.mutate(parsed.data);
        })}
      >
        <fieldset>
          <legend>{t('llmSettings')}</legend>
          <div className="profile-grid">
            <div className="profile-field">
              <label htmlFor="llmProvider">{t('provider')}</label>
              <select id="llmProvider" {...form.register('llmProvider')}>
                {['anthropic', 'openai', 'mistral', 'ollama'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Field
              form={form}
              name="generationModel"
              label={t('generationModel')}
            />
            <Field form={form} name="scoringModel" label={t('scoringModel')} />
            <div className="profile-field">
              <label htmlFor="embeddingProvider">
                {t('embeddingProvider')}
              </label>
              <select
                id="embeddingProvider"
                {...form.register('embeddingProvider')}
              >
                {['openai', 'voyage', 'mistral', 'ollama'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Field
              form={form}
              name="embeddingModel"
              label={t('embeddingModel')}
            />
            <Field form={form} name="ollamaBaseUrl" label={t('ollamaUrl')} />
          </div>
          <p className="profile-help">{t('modelsHelp')}</p>
        </fieldset>
        <fieldset>
          <legend>{t('imapTitle')}</legend>
          <label className="profile-check">
            <input
              type="checkbox"
              checked={imapEnabled}
              onChange={(e) => {
                setImapEnabled(e.target.checked);
                if (e.target.checked && !form.getValues('imap'))
                  form.setValue('imap', {
                    host: '',
                    port: 993,
                    username: '',
                    mailbox: 'INBOX',
                    allowedSenders: [],
                  });
              }}
            />
            {t('configureImap')}
          </label>
          {imapEnabled && (
            <>
              <div className="profile-grid">
                <Field form={form} name="imap.host" label={t('imapHost')} />
                <Controller
                  control={form.control}
                  name="imap.port"
                  render={({ field }) => (
                    <div className="profile-field">
                      <label htmlFor="imapPort">{t('port')}</label>
                      <input
                        id="imapPort"
                        type="number"
                        min="1"
                        max="65535"
                        value={field.value ?? 993}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </div>
                  )}
                />
                <Field form={form} name="imap.username" label={t('username')} />
                <Field form={form} name="imap.mailbox" label={t('mailbox')} />
              </div>
              <Controller
                control={form.control}
                name="imap.allowedSenders"
                render={({ field }) => (
                  <div className="profile-field">
                    <label htmlFor="senders">{t('allowedSenders')}</label>
                    <textarea
                      id="senders"
                      rows={3}
                      value={field.value?.join('\n') ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value
                            .split('\n')
                            .map((v) => v.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                  </div>
                )}
              />
            </>
          )}
          <p className="profile-help">{t('imapHelp')}</p>
        </fieldset>
        {message && <p role="status">{message}</p>}
        <Button type="submit" disabled={mutation.isPending}>
          {t(mutation.isPending ? 'saving' : 'save')}
        </Button>
      </form>
    </div>
  );
}
function SecretEditor() {
  const t = useTranslations('Profile');
  const query = useQuery({
    queryKey: ['secrets'],
    queryFn: apiClient.secrets,
    gcTime: 0,
  });
  return (
    <div className="profile-editor">
      <h2>{t('secretsTitle')}</h2>
      <p className="profile-help">{t('secretsHelp')}</p>
      {query.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : query.isError ? (
        <p role="alert">
          {t('loadError')}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </p>
      ) : (
        <div className="profile-secret-list">
          {secretKindSchema.options.map((kind) => {
            const status = query.data.find((s) => s.kind === kind);
            return (
              <SecretField
                key={kind}
                kind={kind}
                configured={status?.configured ?? false}
                lastFour={status?.lastFour ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
function SecretField({
  kind,
  configured,
  lastFour,
}: {
  kind: SecretKind;
  configured: boolean;
  lastFour: string | null;
}) {
  const t = useTranslations('Profile');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const client = useQueryClient();
  const describeError = useProfileMessage();
  const mutation = useMutation({
    mutationFn: async () => apiClient.saveSecret(kind, value),
    onSuccess: async () => {
      setValue('');
      toast.success(t('saved'));
      await client.invalidateQueries({ queryKey: ['secrets'] });
    },
    onError: (error) => setMessage(describeError(error)),
  });
  return (
    <form
      className="profile-secret"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="profile-field">
        <label htmlFor={kind}>{t(`secret_${kind}`)}</label>
        <span className="profile-help">
          {configured
            ? `${t('configured')} ••••${lastFour}`
            : t('notConfigured')}
        </span>
        <Input
          id={kind}
          type="password"
          autoComplete="new-password"
          value={value}
          minLength={8}
          maxLength={8192}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="profile-actions">
        <Button type="submit" disabled={!value || mutation.isPending}>
          {t(configured ? 'replace' : 'save')}
        </Button>
        {configured && (
          <DeleteButton
            onDelete={async () => {
              await apiClient.deleteSecret(kind);
              setValue('');
              await client.invalidateQueries({ queryKey: ['secrets'] });
            }}
          />
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function CompaniesEditor() {
  const t = useTranslations('Profile');
  const query = useQuery({
    queryKey: ['companies'],
    queryFn: apiClient.companies,
  });
  const [selected, setSelected] = useState<CompanyRecord | null>(null);
  return (
    <div className="profile-editor">
      <div className="profile-toolbar">
        <h2>{t('companiesTitle')}</h2>
        <Button onClick={() => setSelected(null)}>{t('newCompany')}</Button>
      </div>
      {query.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : query.isError ? (
        <p role="alert">
          {t('loadError')}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </p>
      ) : (
        <div className="profile-records">
          {query.data.map((v) => (
            <Button variant="outline" key={v.id} onClick={() => setSelected(v)}>
              {v.name} · {v.atsType}
            </Button>
          ))}
          {!query.data.length && <p>{t('noCompanies')}</p>}
        </div>
      )}
      <CompanyForm
        key={selected?.id ?? 'new'}
        record={selected}
        onSaved={setSelected}
      />
    </div>
  );
}
function CompanyForm({
  record,
  onSaved,
}: {
  record: CompanyRecord | null;
  onSaved: (value: CompanyRecord | null) => void;
}) {
  const t = useTranslations('Profile');
  const client = useQueryClient();
  const describeError = useProfileMessage();
  const [message, setMessage] = useState('');
  const form = useForm<CompanyInput>({
    defaultValues: record
      ? {
          name: record.name,
          atsType: record.atsType,
          atsToken: record.atsToken,
        }
      : { name: '', atsType: 'greenhouse', atsToken: '' },
  });
  const mutation = useMutation({
    mutationFn: (value: CompanyInput) =>
      apiClient.saveCompany(record?.id, value),
    onSuccess: async (value) => {
      form.reset({
        name: value.name,
        atsType: value.atsType,
        atsToken: value.atsToken,
      });
      onSaved(value);
      toast.success(t('saved'));
      await client.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (error) => setMessage(describeError(error)),
  });
  return (
    <form
      onSubmit={form.handleSubmit((value) => {
        const parsed = companyInputSchema.safeParse(value);
        if (!parsed.success) {
          setMessage(t('validation'));
          return;
        }
        mutation.mutate(parsed.data);
      })}
    >
      <fieldset>
        <legend>{t('trackedCompany')}</legend>
        <div className="profile-grid">
          <Field form={form} name="name" label={t('company')} />
          <div className="profile-field">
            <label htmlFor="atsType">{t('atsType')}</label>
            <select id="atsType" {...form.register('atsType')}>
              {['greenhouse', 'lever', 'ashby'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <Field form={form} name="atsToken" label={t('atsToken')} />
        </div>
        <p className="profile-help">{t('atsHelp')}</p>
      </fieldset>
      {message && <p role="status">{message}</p>}
      <div className="profile-actions">
        <Button type="submit" disabled={mutation.isPending}>
          {t('save')}
        </Button>
        {record && (
          <DeleteButton
            onDelete={async () => {
              await apiClient.deleteCompany(record.id);
              await client.invalidateQueries({ queryKey: ['companies'] });
              onSaved(null);
            }}
          />
        )}
      </div>
    </form>
  );
}
