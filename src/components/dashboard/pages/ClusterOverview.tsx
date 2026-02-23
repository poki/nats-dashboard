import { For, Show, createMemo, createSignal, createEffect, Switch, Match } from 'solid-js';

import { useStore } from '~/components/context/store';
import { useMultiVarz, type ServerVarzResult } from '~/components/dashboard/multi-queries';
import { Stats, StatCell } from '~/components/dashboard/Stats';
import Indicator from '~/components/Indicator';
import { LoadingIcon } from '~/components/icons';
import { formatBytes, abbreviateNum, msTimeDiff } from '~/lib/utils';

/** Raw (unformatted) rates for a single server or aggregate. */
interface RawRates {
  inMsgsRate: number;
  outMsgsRate: number;
  inBytesRate: number;
  outBytesRate: number;
}

/** Compute raw per-second rates from two varz snapshots. Returns null if not enough data. */
function computeRates(current: NonNullable<ServerVarzResult['current']>, previous: ServerVarzResult['previous']): RawRates | null {
  if (!previous?.now || !current.now) return null;
  const timeDeltaSec = msTimeDiff(previous.now, current.now) / 1000;
  if (timeDeltaSec <= 0) return null;

  return {
    inMsgsRate: Math.max((current.in_msgs ?? 0) - (previous.in_msgs ?? 0), 0) / timeDeltaSec,
    outMsgsRate: Math.max((current.out_msgs ?? 0) - (previous.out_msgs ?? 0), 0) / timeDeltaSec,
    inBytesRate: Math.max((current.in_bytes ?? 0) - (previous.in_bytes ?? 0), 0) / timeDeltaSec,
    outBytesRate: Math.max((current.out_bytes ?? 0) - (previous.out_bytes ?? 0), 0) / timeDeltaSec,
  };
}

/** Aggregated metrics summed (or averaged) across all healthy replicas. */
interface AggregatedMetrics {
  replicaCount: number;
  healthyCount: number;
  connections: number;
  totalConnections: number;
  subscriptions: number;
  slowConsumers: number;
  inMsgs: number;
  outMsgs: number;
  inBytes: number;
  outBytes: number;
  mem: number;
  avgCpu: number;
  routes: number;
  leafnodes: number;
  /** Summed msg/s rates across all replicas that have a previous snapshot. */
  inMsgsRate: number;
  outMsgsRate: number;
  /** Summed byte/s rates across all replicas that have a previous snapshot. */
  inBytesRate: number;
  outBytesRate: number;
}

export default function ClusterOverview() {
  const [store] = useStore();
  // Use the live discovered servers from the store so the cluster view
  // automatically reflects whatever the port-scan found.
  const getResults = useMultiVarz(() => store.servers);

  const aggregated = createMemo((): AggregatedMetrics | null => {
    const results = getResults();
    const healthy = results.filter((r) => r.isSuccess && r.current);

    if (healthy.length === 0) return null;

    const sum = (fn: (r: ServerVarzResult) => number) =>
      healthy.reduce((acc, r) => acc + fn(r), 0);

    // Compute per-server raw rates and sum them.
    const serverRates = healthy.map((r) =>
      r.current ? computeRates(r.current, r.previous) : null
    );

    const sumRate = (fn: (r: RawRates) => number) =>
      serverRates.reduce((acc, r) => acc + (r ? fn(r) : 0), 0);

    return {
      replicaCount: results.length,
      healthyCount: healthy.length,
      connections: sum((r) => r.current?.connections ?? 0),
      totalConnections: sum((r) => r.current?.total_connections ?? 0),
      subscriptions: sum((r) => r.current?.subscriptions ?? 0),
      slowConsumers: sum((r) => r.current?.slow_consumers ?? 0),
      inMsgs: sum((r) => r.current?.in_msgs ?? 0),
      outMsgs: sum((r) => r.current?.out_msgs ?? 0),
      inBytes: sum((r) => r.current?.in_bytes ?? 0),
      outBytes: sum((r) => r.current?.out_bytes ?? 0),
      mem: sum((r) => r.current?.mem ?? 0),
      avgCpu:
        healthy.length > 0
          ? sum((r) => r.current?.cpu ?? 0) / healthy.length
          : 0,
      routes: sum((r) => r.current?.routes ?? 0),
      leafnodes: sum((r) => r.current?.leafnodes ?? 0),
      inMsgsRate: sumRate((r) => r.inMsgsRate),
      outMsgsRate: sumRate((r) => r.outMsgsRate),
      inBytesRate: sumRate((r) => r.inBytesRate),
      outBytesRate: sumRate((r) => r.outBytesRate),
    };
  });

  const anyLoading = createMemo(() => getResults().some((r) => r.isLoading));
  const allError = createMemo(() => getResults().every((r) => r.isError));

  // Only push a new value to the display once ALL servers have finished their
  // current fetch round. This prevents the stats panel from flickering once
  // per replica each interval (e.g. 3 repaints/s with 3 replicas).
  const [displayedAgg, setDisplayedAgg] = createSignal<AggregatedMetrics | null>(null);
  createEffect(() => {
    const agg = aggregated();
    if (!agg) return;
    const allSettled = getResults().every((r) => !r.isFetching);
    if (allSettled) {
      setDisplayedAgg(() => agg);
    }
  });

  return (
    <div>
      {/* Aggregate header */}
      <div class="relative flex flex-col items-start justify-between gap-x-8 gap-y-4 bg-gray-50 dark:bg-gray-700/10 px-4 py-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div>
          <div class="flex items-center gap-x-3">
            <Indicator
              color={
                !store.active
                  ? 'gray'
                  : allError()
                    ? 'red'
                    : displayedAgg()?.healthyCount === displayedAgg()?.replicaCount
                      ? 'green'
                      : 'red'
              }
              title={
                !store.active
                  ? 'Not Monitoring'
                  : allError()
                    ? 'All Replicas Unreachable'
                    : `${displayedAgg()?.healthyCount ?? 0}/${displayedAgg()?.replicaCount ?? 0} Replicas Healthy`
              }
            />
            <h1 class="text-base font-semibold leading-7 text-gray-900 dark:text-white">
              Cluster Overview
            </h1>
          </div>
          <p class="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
            <Show when={displayedAgg()}>
              {(agg) => (
                <>
                  {agg().healthyCount}/{agg().replicaCount} replicas healthy
                </>
              )}
            </Show>
            <Show when={!store.active}> — monitoring paused</Show>
          </p>
        </div>

        <div class="order-first flex-none rounded-full bg-sky-50 text-sky-700 ring-sky-700/10 dark:bg-sky-400/10 px-2 py-1 text-xs font-medium dark:text-sky-400 ring-1 ring-inset dark:ring-sky-400/30 sm:order-none">
          {store.servers.length} Replicas
        </div>
      </div>

      {/* Aggregated stats — mirrors the layout of the single-replica ServerStats */}
      <Show when={displayedAgg()}>
        {(agg) => (
          <Stats>
            {/* Row 1: system metrics */}
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px">
              <StatCell
                title="Avg CPU Load"
                stat={agg().avgCpu.toFixed(1)}
                unit="%"
              />
              <StatCell
                title="Total Memory"
                stat={formatBytes(agg().mem).value}
                unit={formatBytes(agg().mem).unit}
              />
              <StatCell
                title="Total Connections"
                stat={abbreviateNum(agg().connections).value}
                unit={abbreviateNum(agg().connections).unit}
              />
              <StatCell
                title="All-time Connections"
                stat={abbreviateNum(agg().totalConnections).value}
                unit={abbreviateNum(agg().totalConnections).unit}
              />
              <StatCell
                title="Subscriptions"
                stat={abbreviateNum(agg().subscriptions).value}
                unit={abbreviateNum(agg().subscriptions).unit}
              />
              <StatCell
                title="Slow Consumers"
                stat={abbreviateNum(agg().slowConsumers).value}
                unit={abbreviateNum(agg().slowConsumers).unit}
              />
            </div>

            {/* Row 2: totals + rates */}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-px mt-px">
              <StatCell
                title="Total Msgs Received"
                stat={abbreviateNum(agg().inMsgs).value}
                unit={abbreviateNum(agg().inMsgs).unit}
              />
              <StatCell
                title="Total Msgs Sent"
                stat={abbreviateNum(agg().outMsgs).value}
                unit={abbreviateNum(agg().outMsgs).unit}
              />
              <StatCell
                title="Total Data Received"
                stat={formatBytes(agg().inBytes).value}
                unit={formatBytes(agg().inBytes).unit}
              />
              <StatCell
                title="Total Data Sent"
                stat={formatBytes(agg().outBytes).value}
                unit={formatBytes(agg().outBytes).unit}
              />
              <StatCell
                title="Msgs Received Rate"
                stat={abbreviateNum(agg().inMsgsRate).value}
                unit={`${abbreviateNum(agg().inMsgsRate).unit ?? ''}/s`}
              />
              <StatCell
                title="Msgs Sent Rate"
                stat={abbreviateNum(agg().outMsgsRate).value}
                unit={`${abbreviateNum(agg().outMsgsRate).unit ?? ''}/s`}
              />
              <StatCell
                title="Data Received Rate"
                stat={formatBytes(agg().inBytesRate).value}
                unit={`${formatBytes(agg().inBytesRate).unit}/s`}
              />
              <StatCell
                title="Data Sent Rate"
                stat={formatBytes(agg().outBytesRate).value}
                unit={`${formatBytes(agg().outBytesRate).unit}/s`}
              />
            </div>
          </Stats>
        )}
      </Show>

      {/* Loading state */}
      <Show when={store.active && anyLoading() && !displayedAgg()}>
        <div class="flex items-center justify-center h-40 px-4 py-6 sm:px-6 lg:px-8 text-gray-900 dark:text-white">
          <LoadingIcon class="h-5 w-5" />
        </div>
      </Show>

      {/* Not started state */}
      <Show when={!store.active && !displayedAgg()}>
        <div class="px-4 py-8 sm:px-6 lg:px-8 text-center text-gray-500 dark:text-gray-400">
          <p class="text-sm">
            Press the play button in the header to start monitoring all replicas.
          </p>
        </div>
      </Show>

      {/* Per-replica cards */}
      <div class="px-4 py-6 sm:px-6 lg:px-8">
        <h2 class="text-sm font-semibold leading-6 text-gray-900 dark:text-white mb-4">
          Replica Status
          <span class="ml-2 font-normal text-gray-400 dark:text-gray-500">
            ({getResults().length})
          </span>
        </h2>
        <div
          class="grid gap-4"
          style="grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr))"
        >
          <For each={getResults()}>
            {(result) => <ReplicaCard result={result} />}
          </For>
        </div>
      </div>
    </div>
  );
}

function ReplicaCard(props: { result: ServerVarzResult }) {
  const [store] = useStore();

  const statusColor = () => {
    if (!store.active) return 'gray' as const;
    if (props.result.isLoading) return 'gray' as const;
    if (props.result.isError) return 'red' as const;
    if (props.result.isSuccess) return 'green' as const;
    return 'gray' as const;
  };

  const statusLabel = () => {
    if (!store.active) return 'Not monitoring';
    if (props.result.isLoading) return 'Connecting…';
    if (props.result.isError) return 'Unreachable';
    if (props.result.isSuccess) return 'Healthy';
    return 'Unknown';
  };

  const rates = () =>
    props.result.current
      ? computeRates(props.result.current, props.result.previous)
      : null;

  return (
    <div class="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Card header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <div class="flex items-center gap-x-2 min-w-0">
          <Indicator color={statusColor()} title={statusLabel()} />
          <span class="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {props.result.server.name ?? props.result.server.url}
          </span>
        </div>
        <span
          class="ml-2 flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
          classList={{
            'bg-emerald-50 text-emerald-700 dark:bg-green-400/10 dark:text-green-400':
              props.result.isSuccess,
            'bg-red-50 text-red-600 dark:bg-rose-400/10 dark:text-rose-400':
              props.result.isError,
            'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400':
              !props.result.isSuccess && !props.result.isError,
          }}
        >
          {statusLabel()}
        </span>
      </div>

      {/* Card body */}
      <div class="px-4 py-3">
        <Switch>
          <Match when={props.result.isError}>
            <p class="text-xs text-red-500 dark:text-rose-400">
              {props.result.error?.message ?? 'Connection failed'}
            </p>
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500 break-all">
              {props.result.server.url}
            </p>
          </Match>

          <Match when={props.result.isSuccess && props.result.current}>
            {(_) => {
              const d = () => props.result.current!;
              const r = rates;
              return (
                <dl class="grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums">
                  <MetricRow
                    label="Server"
                    value={d().server_name ?? d().server_id ?? '—'}
                  />
                  <MetricRow label="Version" value={`v${d().version}`} />
                  <MetricRow
                    label="CPU"
                    value={`${d().cpu?.toFixed(1) ?? 0}%`}
                  />
                  <MetricRow
                    label="Memory"
                    value={`${formatBytes(d().mem ?? 0).value} ${formatBytes(d().mem ?? 0).unit}`}
                  />
                  <MetricRow
                    label="Connections"
                    value={String(d().connections ?? 0)}
                  />
                  <MetricRow
                    label="Subscriptions"
                    value={String(d().subscriptions ?? 0)}
                  />
                  <MetricRow
                    label="Msgs In"
                    value={`${abbreviateNum(d().in_msgs ?? 0).value}${abbreviateNum(d().in_msgs ?? 0).unit ? ' ' + abbreviateNum(d().in_msgs ?? 0).unit : ''}`}
                  />
                  <MetricRow
                    label="Msgs Out"
                    value={`${abbreviateNum(d().out_msgs ?? 0).value}${abbreviateNum(d().out_msgs ?? 0).unit ? ' ' + abbreviateNum(d().out_msgs ?? 0).unit : ''}`}
                  />
                  {/* Rates — only shown after the first poll cycle */}
                  <Show when={r()}>
                    {(rates) => (
                      <>
                        <MetricRow
                          label="Msgs In/s"
                          value={`${abbreviateNum(rates().inMsgsRate).value}${abbreviateNum(rates().inMsgsRate).unit ? ' ' + abbreviateNum(rates().inMsgsRate).unit : ''}`}
                        />
                        <MetricRow
                          label="Msgs Out/s"
                          value={`${abbreviateNum(rates().outMsgsRate).value}${abbreviateNum(rates().outMsgsRate).unit ? ' ' + abbreviateNum(rates().outMsgsRate).unit : ''}`}
                        />
                        <MetricRow
                          label="Data In/s"
                          value={`${formatBytes(rates().inBytesRate).value} ${formatBytes(rates().inBytesRate).unit}`}
                        />
                        <MetricRow
                          label="Data Out/s"
                          value={`${formatBytes(rates().outBytesRate).value} ${formatBytes(rates().outBytesRate).unit}`}
                        />
                      </>
                    )}
                  </Show>
                  <Show when={d().cluster?.name}>
                    <MetricRow label="Cluster" value={d().cluster!.name!} />
                  </Show>
                  <Show when={d().routes !== undefined}>
                    <MetricRow label="Routes" value={String(d().routes)} />
                  </Show>
                </dl>
              );
            }}
          </Match>

          <Match when={!store.active}>
            <p class="text-xs text-gray-400 dark:text-gray-500 break-all">
              {props.result.server.url}
            </p>
          </Match>

          <Match when={props.result.isLoading}>
            <div class="flex items-center gap-x-2 text-xs text-gray-400 dark:text-gray-500">
              <LoadingIcon class="h-3 w-3" />
              <span>Fetching data…</span>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <>
      <dt class="text-xs text-gray-500 dark:text-gray-400 truncate">
        {props.label}
      </dt>
      <dd class="text-xs font-medium text-gray-900 dark:text-white text-right truncate">
        {props.value}
      </dd>
    </>
  );
}
