'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  searchInputSchema,
  type SearchInput,
  type SearchRecord,
} from '@jobpilot/shared/profile';
import { contractTypeSchema, remoteSchema } from '@jobpilot/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Field,
  DeleteButton,
  ProfileHeader,
  useProfileMessage,
} from './form-parts';
export function SearchesPage() {
  const t = useTranslations('Profile');
  const searches = useQuery({
    queryKey: ['searches'],
    queryFn: apiClient.searches,
  });
  const resumes = useQuery({
    queryKey: ['resumes'],
    queryFn: apiClient.resumes,
  });
  const [selected, setSelected] = useState<SearchRecord | null | undefined>();
  return (
    <section className="profile-page">
      <ProfileHeader
        title={t('searchesTitle')}
        description={t('searchesDescription')}
      >
        <Button
          disabled={!resumes.data?.some((r) => !r.isArchived)}
          onClick={() => setSelected(null)}
        >
          {t('newSearch')}
        </Button>
      </ProfileHeader>
      {searches.isPending || resumes.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : searches.isError || resumes.isError ? (
        <p role="alert">
          {t('loadError')}
          <Button
            variant="outline"
            onClick={() => {
              void searches.refetch();
              void resumes.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </p>
      ) : (
        <>
          <div className="profile-records">
            {searches.data.map((record) => (
              <Button
                key={record.id}
                variant={selected?.id === record.id ? 'default' : 'outline'}
                onClick={() => setSelected(record)}
              >
                {record.name} ({t(record.isActive ? 'active' : 'inactive')})
              </Button>
            ))}
            {!searches.data.length && <p>{t('noSearches')}</p>}
          </div>
          {!resumes.data.some((r) => !r.isArchived) && <p>{t('needResume')}</p>}
          {selected !== undefined && (
            <SearchEditor
              key={selected?.id ?? 'new'}
              record={selected}
              resumes={resumes.data.filter(
                (r) => !r.isArchived || r.id === selected?.resumeId,
              )}
              onSaved={setSelected}
              onDeleted={() => setSelected(undefined)}
            />
          )}
        </>
      )}
    </section>
  );
}
function SearchEditor({
  record,
  resumes,
  onSaved,
  onDeleted,
}: {
  record: SearchRecord | null;
  resumes: { id: string; title: string }[];
  onSaved: (v: SearchRecord) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('Profile');
  const client = useQueryClient();
  const describeError = useProfileMessage();
  const [message, setMessage] = useState('');
  const form = useForm<SearchInput>({
    defaultValues: record ?? {
      name: '',
      resumeId: resumes[0]?.id ?? '',
      titles: [],
      includeKeywords: [],
      excludeKeywords: [],
      locations: [],
      remote: ['hybrid', 'full'],
      contractTypes: ['permanent'],
      sources: ['adzuna'],
      isActive: true,
    },
  });
  const mutation = useMutation({
    mutationFn: (value: SearchInput) => apiClient.saveSearch(record?.id, value),
    onSuccess: async (value) => {
      form.reset(value);
      onSaved(value);
      toast.success(t('saved'));
      await client.invalidateQueries({ queryKey: ['searches'] });
    },
    onError: (error) => setMessage(describeError(error)),
  });
  const lists = (
    name: 'titles' | 'includeKeywords' | 'excludeKeywords',
    label: string,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="profile-field">
          <label htmlFor={name}>{t(label)}</label>
          <textarea
            id={name}
            rows={3}
            value={field.value.join('\n')}
            onChange={(e) => field.onChange(e.target.value.split('\n'))}
          />
        </div>
      )}
    />
  );
  return (
    <div className="profile-editor">
      <h2>{record ? record.name : t('newSearch')}</h2>
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={form.handleSubmit((value) => {
          const parsed = searchInputSchema.safeParse({
            ...value,
            titles: value.titles.map((v) => v.trim()).filter(Boolean),
            includeKeywords: value.includeKeywords
              .map((v) => v.trim())
              .filter(Boolean),
            excludeKeywords: value.excludeKeywords
              .map((v) => v.trim())
              .filter(Boolean),
          });
          if (!parsed.success) {
            setMessage(t('validation'));
            return;
          }
          mutation.mutate(parsed.data);
        })}
      >
        <fieldset>
          <legend>{t('searchCriteria')}</legend>
          <div className="profile-grid">
            <Field form={form} name="name" label={t('searchName')} />
            <div className="profile-field">
              <label htmlFor="resumeId">{t('resume')}</label>
              <select id="resumeId" {...form.register('resumeId')}>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {lists('titles', 'targetTitles')}
          {lists('includeKeywords', 'includeKeywords')}
          {lists('excludeKeywords', 'excludeKeywords')}
          <div className="profile-grid">
            <Field
              form={form}
              name="seniority"
              label={t('seniority')}
              optional
            />
            <Controller
              control={form.control}
              name="salaryMin"
              render={({ field }) => (
                <div className="profile-field">
                  <label htmlFor="salaryMin">{t('salaryMin')}</label>
                  <input
                    id="salaryMin"
                    type="number"
                    min="0"
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                  />
                </div>
              )}
            />
          </div>
          <label className="profile-check">
            <input type="checkbox" {...form.register('isActive')} />
            {t('active')}
          </label>
        </fieldset>
        <fieldset>
          <legend>{t('locations')}</legend>
          <Controller
            name="locations"
            control={form.control}
            render={({ field }) => (
              <div className="profile-field">
                <label htmlFor="locations">{t('locationsHelp')}</label>
                <textarea
                  id="locations"
                  rows={3}
                  defaultValue={field.value
                    .map((l) =>
                      [l.city, l.postalCode ?? '', l.country].join(';'),
                    )
                    .join('\n')}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value
                        .split('\n')
                        .filter((v) => v.trim())
                        .map((line) => {
                          const [city = '', postalCode = '', country = ''] =
                            line.split(';');
                          return {
                            city: city.trim(),
                            ...(postalCode.trim()
                              ? { postalCode: postalCode.trim() }
                              : {}),
                            country: country.trim().toUpperCase(),
                          };
                        }),
                    )
                  }
                />
              </div>
            )}
          />
          <Controller
            name="radiusKm"
            control={form.control}
            render={({ field }) => (
              <div className="profile-field">
                <label htmlFor="radiusKm">{t('radius')}</label>
                <input
                  id="radiusKm"
                  type="number"
                  min="0"
                  step="1"
                  value={field.value ?? ''}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </div>
            )}
          />
        </fieldset>
        <fieldset>
          <legend>{t('remote')}</legend>
          {remoteSchema.options.map((v) => (
            <label key={v} className="profile-check">
              <input type="checkbox" value={v} {...form.register('remote')} />
              {t(`remote_${v}`)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('contracts')}</legend>
          {contractTypeSchema.options.map((v) => (
            <label key={v} className="profile-check">
              <input
                type="checkbox"
                value={v}
                {...form.register('contractTypes')}
              />
              {t(`contract_${v}`)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('sources')}</legend>
          {searchInputSchema.shape.sources.element.options.map((v) => (
            <label key={v} className="profile-check">
              <input type="checkbox" value={v} {...form.register('sources')} />
              {t(`source_${v}`)}
            </label>
          ))}
          <p className="profile-help">{t('sourcesHelp')}</p>
        </fieldset>
        <Button type="submit" disabled={mutation.isPending}>
          {t(mutation.isPending ? 'saving' : 'save')}
        </Button>
      </form>
      {record && (
        <div className="profile-actions">
          <DeleteButton
            onDelete={async () => {
              await apiClient.deleteSearch(record.id);
              await client.invalidateQueries({ queryKey: ['searches'] });
              onDeleted();
            }}
          />
        </div>
      )}
    </div>
  );
}
