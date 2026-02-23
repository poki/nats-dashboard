import { A, useLocation, useNavigate, type AnchorProps } from '@solidjs/router';
import { For, Show } from 'solid-js';

import type { Server } from '~/components/context/config';
import { useStore } from '~/components/context/store';

/** Show individual tabs up to this many replicas; beyond that use a dropdown. */
const TAB_THRESHOLD = 6;

export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [store, storeActions] = useStore();

  // Use the live discovered list from the store. Falls back to empty list
  // before discovery has run (tabs are hidden until at least 2 servers exist).
  const servers = () => store.servers;

  const isCluster = () => location.pathname === '/cluster';
  const serverCount = () => servers().length;
  const useTabs = () => serverCount() <= TAB_THRESHOLD;

  // Preserve query params when navigating between non-cluster pages.
  const path = (p: string) =>
    isCluster() ? p : `${p}${location.search}`;

  const handleServerClick = (server: Server) => {
    storeActions.setServer(server);
    storeActions.setActive(true);
    if (isCluster()) {
      navigate('/');
    }
  };

  const handleDropdownChange = (e: Event) => {
    const url = (e.currentTarget as HTMLSelectElement).value;
    if (!url) return;
    const server = servers().find((s: Server) => s.url === url);
    if (server) handleServerClick(server);
  };

  const isServerActive = (server: Server) =>
    !isCluster() && store.server.url === server.url;

  const activeServerLabel = () => {
    if (isCluster()) return '';
    const s = servers().find((s: Server) => s.url === store.server.url);
    return s?.name ?? s?.url ?? '';
  };

  return (
    <nav class="border-b border-gray-200 dark:border-white/10">
      {/* Server / replica selector — only shown when multiple servers are configured */}
      <Show when={serverCount() > 1}>
        <div class="flex items-center overflow-x-auto border-b border-gray-100 dark:border-white/5 py-2 gap-x-2 px-4 sm:px-6 lg:px-8">
          {/* "All Replicas" link — always visible */}
          <A
            href="/cluster"
            end={true}
            class="flex-shrink-0 inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap"
            activeClass="bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400"
            inactiveClass="text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-gray-300"
          >
            All Replicas
            <span class="ml-1.5 text-xs opacity-60">({serverCount()})</span>
          </A>

          {/* Separator */}
          <div class="flex-shrink-0 h-4 w-px bg-gray-200 dark:bg-gray-700" />

          {/* Individual tabs — shown when replica count ≤ TAB_THRESHOLD */}
          <Show when={useTabs()}>
            <ul role="list" class="flex flex-none gap-x-1">
              <For each={servers()}>
                {(server) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => handleServerClick(server)}
                      class="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap"
                      classList={{
                        'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400':
                          isServerActive(server),
                        'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-gray-300':
                          !isServerActive(server),
                      }}
                    >
                      {server.name ?? server.url}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          {/* Dropdown — shown when replica count > TAB_THRESHOLD */}
          <Show when={!useTabs()}>
            <select
              class="text-sm rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={isCluster() ? '' : store.server.url}
              onChange={handleDropdownChange}
            >
              <option value="" disabled>
                {isCluster()
                  ? `Select a replica…`
                  : `${activeServerLabel()} ▾`}
              </option>
              <For each={servers()}>
                {(server) => (
                  <option value={server.url}>
                    {server.name ?? server.url}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </div>
      </Show>

      {/* Page navigation — hidden on the cluster overview page */}
      <Show when={!isCluster()}>
        <div class="flex overflow-x-auto py-4">
          <ul
            role="list"
            class="flex min-w-full flex-none gap-x-6 px-4 text-sm font-semibold leading-6 text-gray-500 dark:text-gray-400 sm:px-6 lg:px-8"
          >
            <li>
              <PageLink href={path('/')}>Overview</PageLink>
            </li>
            <li>
              <PageLink href={path('/info')}>Info</PageLink>
            </li>
            <li>
              <PageLink href={path('/connections')}>Connections</PageLink>
            </li>
            <li>
              <PageLink href={path('/jetstream')}>JetStream</PageLink>
            </li>
          </ul>
        </div>
      </Show>
    </nav>
  );
}

function PageLink(props: AnchorProps) {
  return (
    <A activeClass="text-sky-600 dark:text-sky-400" end={true} {...props} />
  );
}
