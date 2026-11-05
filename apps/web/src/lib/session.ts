'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './api-client';
export const sessionKey = ['session'] as const;
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: () => apiClient.me(),
    refetchInterval: 60000,
  });
}
