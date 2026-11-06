import { operationsStatusSchema } from '@jobpilot/shared/operations';
import {
  applicationPageSchema,
  applicationRecordSchema,
  applicationCreateSchema,
  applicationUpdateSchema,
  applicationMoveSchema,
  applicationDocumentPageSchema,
  localCalendarDate,
  type ApplicationFields,
  type ApplicationStatus,
} from '@jobpilot/shared/applications';
import {
  documentHistorySchema,
  generationInputSchema,
  documentEditSchema,
  documentReviewSchema,
  documentDetailSchema,
  type DocumentContent,
  type GenerationParams,
} from '@jobpilot/shared/generation';
import {
  jobQuerySchema,
  jobRecordSchema,
  jobsPageSchema,
  jobsSummarySchema,
  jobStatusInputSchema,
  type JobQuery,
} from '@jobpilot/shared/jobs';
import { collectionRunSchema } from '@jobpilot/shared/collection';
import { importProposalSchema, usageSummarySchema } from '@jobpilot/shared/llm';
import { z } from 'zod';
import {
  loginSchema,
  currentUserSchema,
  csrfResponseSchema as csrfSchema,
  loginResponseSchema,
  type LoginInput,
  type CurrentUser,
} from '@jobpilot/shared';
import {
  resumeInputSchema,
  resumeRecordSchema,
  searchInputSchema,
  searchRecordSchema,
  profileSettingsSchema,
  secretStatusSchema,
  secretInputSchema,
  companyInputSchema,
  companyRecordSchema,
  type ResumeInput,
  type SearchInput,
  type ProfileSettings,
  type SecretKind,
  type CompanyInput,
} from '@jobpilot/shared/profile';
import { apiOrigin } from './environment.ts';
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function createApiClient(fetcher: typeof fetch = fetch) {
  let csrfToken: string | undefined;
  let pendingCsrf: Promise<string> | undefined;
  async function send(path: string, options: RequestInit = {}, binary = false) {
    const response = await fetcher(apiOrigin + path, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json().catch(() => null));
      throw new ApiClientError(
        response.status,
        error.success ? error.data.error.code : 'REQUEST_FAILED',
      );
    }
    if (binary) return response.blob();
    return response.json() as Promise<unknown>;
  }
  async function getCsrf() {
    if (csrfToken) return csrfToken;
    if (!pendingCsrf)
      pendingCsrf = send('/auth/csrf')
        .then((value) => {
          csrfToken = csrfSchema.parse(value).csrfToken;
          return csrfToken;
        })
        .finally(() => {
          pendingCsrf = undefined;
        });
    return pendingCsrf;
  }
  async function write(path: string, payload: unknown, method = 'POST') {
    const perform = async () =>
      send(path, {
        method,
        headers: {
          'Content-Type':
            payload instanceof Blob ? 'application/pdf' : 'application/json',
          'X-CSRF-Token': await getCsrf(),
        },
        body: payload instanceof Blob ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(
          path.startsWith('/resumes') || /\/jobs\/[^/]+\/documents$/.test(path)
            ? 210000
            : 15000,
        ),
      });
    try {
      return await perform();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'CSRF_INVALID') {
        csrfToken = undefined;
        return perform();
      }
      throw error;
    }
  }
  return {
    operations: async () =>
      operationsStatusSchema
        .nullable()
        .parse(await send('/settings/operations')),
    documents: async (matchId: string, cursor?: string) =>
      documentHistorySchema.parse(
        await send(
          '/jobs/' +
            matchId +
            '/documents' +
            (cursor ? '?cursor=' + cursor : ''),
        ),
      ),
    generateDocument: async (
      matchId: string,
      resumeId: string,
      kind: 'resume' | 'cover_letter',
      params: GenerationParams,
    ) =>
      documentDetailSchema.parse(
        await write(
          '/jobs/' + matchId + '/documents',
          generationInputSchema.parse({ resumeId, kind, params }),
        ),
      ),
    editDocument: async (id: string, content: DocumentContent) =>
      documentDetailSchema.parse(
        await write(
          '/documents/' + id + '/versions',
          documentEditSchema.parse({ content }),
        ),
      ),
    reviewDocument: async (
      id: string,
      sourceFingerprint: string,
      issueIds: string[],
    ) =>
      documentDetailSchema.parse(
        await write(
          '/documents/' + id + '/review',
          documentReviewSchema.parse({ sourceFingerprint, issueIds }),
        ),
      ),
    documentPdf: async (id: string) =>
      (await send('/documents/' + id + '/pdf', {}, true)) as Blob,
    documentText: async (id: string) =>
      z
        .object({ text: z.string() })
        .parse(await send('/documents/' + id + '/text')),
    applications: async (cursor?: string) =>
      applicationPageSchema.parse(
        await send('/applications' + (cursor ? '?cursor=' + cursor : '')),
      ),
    application: async (id: string) =>
      applicationRecordSchema.parse(await send('/applications/' + id)),
    createApplication: async (
      matchId: string,
      status: ApplicationStatus = 'to_apply',
    ) =>
      applicationRecordSchema.parse(
        await write(
          '/jobs/' + matchId + '/application',
          applicationCreateSchema.parse({
            status,
            appliedAt: status === 'to_apply' ? null : localCalendarDate(),
          }),
        ),
      ),
    updateApplication: async (
      id: string,
      revision: number,
      fields: ApplicationFields,
    ) =>
      applicationRecordSchema.parse(
        await write(
          '/applications/' + id,
          applicationUpdateSchema.parse({ revision, fields }),
        ),
      ),
    moveApplication: async (
      id: string,
      revision: number,
      status: ApplicationStatus,
    ) =>
      applicationRecordSchema.parse(
        await write(
          '/applications/' + id + '/status',
          applicationMoveSchema.parse({
            revision,
            status,
            appliedAt: localCalendarDate(),
          }),
        ),
      ),
    applicationDocuments: async (id: string, cursor?: string) =>
      applicationDocumentPageSchema.parse(
        await send(
          '/applications/' +
            id +
            '/documents' +
            (cursor ? '?cursor=' + cursor : ''),
        ),
      ),
    document: async (id: string) =>
      documentDetailSchema.parse(await send('/documents/' + id)),
    jobs: async (query: JobQuery) => {
      const values = jobQuerySchema.parse(query);
      const params = new URLSearchParams(
        Object.entries(values).map(([k, v]) => [k, String(v)]),
      );
      return jobsPageSchema.parse(await send('/jobs?' + params));
    },
    job: async (id: string) => jobRecordSchema.parse(await send('/jobs/' + id)),
    jobStatus: async (
      id: string,
      status: 'new' | 'interesting' | 'ignored' | 'applied',
    ) =>
      jobRecordSchema.parse(
        await write(
          '/jobs/' + id + '/status',
          jobStatusInputSchema.parse({
            status,
            ...(status === 'applied' ? { appliedAt: localCalendarDate() } : {}),
          }),
        ),
      ),
    jobsSummary: async () =>
      jobsSummarySchema.parse(await send('/jobs/summary')),
    latestCollection: async () =>
      collectionRunSchema.nullable().parse(await send('/collections')),
    collection: async (id: string) =>
      collectionRunSchema.parse(await send('/collections/' + id)),
    startCollection: async () =>
      collectionRunSchema.parse(await write('/collections', {})),
    importResume: async (file: File) =>
      importProposalSchema.parse(await write('/resumes/import', file)),
    reindexResume: async (id: string) =>
      resumeRecordSchema.parse(
        await write('/resumes/' + id + '/embedding', {}),
      ),
    llmUsage: async () => usageSummarySchema.parse(await send('/llm/usage')),
    resumes: async () =>
      z.array(resumeRecordSchema).parse(await send('/resumes')),
    saveResume: async (id: string | undefined, value: ResumeInput) =>
      resumeRecordSchema.parse(
        await write(
          '/resumes' + (id ? '/' + id : ''),
          resumeInputSchema.parse(value),
        ),
      ),
    deleteResume: async (id: string) => {
      await write('/resumes/' + id, {}, 'DELETE');
    },
    resumePdf: async (id: string) =>
      z.instanceof(Blob).parse(await send('/resumes/' + id + '/pdf', {}, true)),
    searches: async () =>
      z.array(searchRecordSchema).parse(await send('/searches')),
    saveSearch: async (id: string | undefined, value: SearchInput) =>
      searchRecordSchema.parse(
        await write(
          '/searches' + (id ? '/' + id : ''),
          searchInputSchema.parse(value),
        ),
      ),
    deleteSearch: async (id: string) => {
      await write('/searches/' + id, {}, 'DELETE');
    },
    settings: async () => profileSettingsSchema.parse(await send('/settings')),
    saveSettings: async (value: ProfileSettings) =>
      profileSettingsSchema.parse(
        await write('/settings', profileSettingsSchema.parse(value)),
      ),
    secrets: async () =>
      z.array(secretStatusSchema).parse(await send('/settings/secrets')),
    saveSecret: async (kind: SecretKind, value: string) =>
      secretStatusSchema.parse(
        await write(
          '/settings/secrets/' + kind,
          secretInputSchema.parse({ value }),
        ),
      ),
    deleteSecret: async (kind: SecretKind) =>
      secretStatusSchema.parse(
        await write('/settings/secrets/' + kind, {}, 'DELETE'),
      ),
    companies: async () =>
      z.array(companyRecordSchema).parse(await send('/settings/companies')),
    saveCompany: async (id: string | undefined, value: CompanyInput) =>
      companyRecordSchema.parse(
        await write(
          '/settings/companies' + (id ? '/' + id : ''),
          companyInputSchema.parse(value),
        ),
      ),
    deleteCompany: async (id: string) => {
      await write('/settings/companies/' + id, {}, 'DELETE');
    },
    async me(): Promise<CurrentUser | null> {
      try {
        return currentUserSchema.parse(await send('/auth/me'));
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          csrfToken = undefined;
          return null;
        }
        throw error;
      }
    },
    async login(input: LoginInput) {
      const result = loginResponseSchema.parse(
        await write('/auth/login', loginSchema.parse(input)),
      );
      csrfToken = result.csrfToken;
      return result.user;
    },
    async logout() {
      await write('/auth/logout', {});
      csrfToken = undefined;
    },
  };
}
export const apiClient = createApiClient();
