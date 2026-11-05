'use client';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
export function LlmUsage() {
  const t = useTranslations('AI');
  const query = useQuery({
    queryKey: ['llm-usage'],
    queryFn: apiClient.llmUsage,
    refetchInterval: 15000,
  });
  return (
    <section className="profile-editor">
      <h2>{t('usageTitle')}</h2>
      {query.isPending ? (
        <p role="status">{t('usageLoading')}</p>
      ) : query.isError ? (
        <p role="alert">{t('usageError')}</p>
      ) : (
        <>
          <p>{t('usagePeriod', { month: query.data.month })}</p>
          <p>
            {t('usageTokens', {
              used: query.data.tokensUsed,
              reserved: query.data.tokensReserved,
              limit: query.data.tokenLimit,
            })}
          </p>
          <p>
            {t(query.data.unpricedCalls ? 'costPartial' : 'costEstimate', {
              cost: query.data.estimatedCostUsd.toFixed(4),
            })}
          </p>
        </>
      )}
      <p className="profile-help">{t('usageHelp')}</p>
    </section>
  );
}
