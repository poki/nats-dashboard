import { createQueries, useQueryClient } from '@tanstack/solid-query';

import type { Server } from '~/components/context/config';
import { fetchInfo } from '~/lib/info';
import { getPrevQueryResponse } from '~/lib/query-utils';
import { useSettings } from '~/components/context/settings';
import { useStore } from '~/components/context/store';
import type { Varz } from '~/types';

export interface ServerVarzResult {
  server: Server;
  /** Current varz response for this server. */
  current: Varz | undefined;
  /** Previous varz response — used for rate calculations. */
  previous: Varz | undefined;
  isLoading: boolean;
  /** True while the query is actively fetching (including background refetches). */
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
}

/**
 * Fetch varz from multiple NATS servers simultaneously.
 *
 * Uses a distinct query key namespace (`'cluster'`) so these queries never
 * share a cache entry with the single-server `useVarz` queries. This prevents
 * the single-server view from seeing stale/transitional data when navigating
 * back from the cluster overview.
 */
export function useMultiVarz(getServers: () => Server[]): () => ServerVarzResult[] {
  const [settings] = useSettings();
  const [store] = useStore();
  const queryClient = useQueryClient();

  const results = createQueries(() => ({
    queries: getServers().map((server) => ({
      // 'cluster' in position 1 ensures this key never matches the single-server
      // [server.url, 'varz'] key, even with exact:false prefix matching.
      queryKey: [server.url, 'cluster', 'varz'] as const,
      queryFn: async ({ queryKey, signal }: { queryKey: readonly [string, string, string]; signal: AbortSignal }) => {
        const current = await fetchInfo({
          url: server.url,
          endpoint: 'varz',
          jsonp: settings.jsonp,
          signal,
        });

        // Retrieve the previous snapshot from this cluster-namespaced cache entry.
        const previous = getPrevQueryResponse<'varz'>({
          client: queryClient,
          queryKey,
          exact: false,
        });

        return { current, previous };
      },
      enabled: store.active,
      refetchInterval: settings.interval,
      reconcile: false as const,
      meta: {
        errorTitle: server.name ?? server.url,
        errorMessage: `Cannot fetch information for ${server.name ?? server.url}.`,
      },
    })),
  }));

  return () =>
    getServers().map((server, i) => {
      const result = results[i];
      const data = result?.data as { current: Varz; previous?: Varz } | undefined;
      return {
        server,
        current: data?.current,
        previous: data?.previous,
        isLoading: result?.isLoading ?? false,
        isFetching: result?.isFetching ?? false,
        isError: result?.isError ?? false,
        isSuccess: result?.isSuccess ?? false,
        error: (result?.error as Error | null) ?? null,
      };
    });
}
