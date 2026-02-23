import { Show, createEffect, onCleanup, type ParentProps } from 'solid-js';
import { Transition } from 'solid-transition-group';

import { useConfig } from '~/components/context/config';
import { useStore } from '~/components/context/store';
import { useSettings } from '~/components/context/settings';
import { discoverReplicas } from '~/lib/discovery';
import InputHeader from '~/components/dashboard/InputHeader';
import Navigation from '~/components/dashboard/Navigation';
import { LoadingIcon } from '~/components/icons';

export default function Root(props: ParentProps) {
  const config = useConfig();
  const [store, storeActions] = useStore();
  const [settings] = useSettings();

  // ── Static initialisation ────────────────────────────────────────────────
  // Set the default active server and seed the servers list from config.
  // Runs once when config first loads (and never again because config is stable).
  createEffect(() => {
    const cfg = config();
    const defaultServer = cfg.server ?? cfg.servers[0];
    if (defaultServer) {
      storeActions.setServer(defaultServer);
      storeActions.setActive(true);
    }
    // Seed the list immediately with whatever is in config so tabs show up
    // before discovery has a chance to run.
    if (cfg.servers.length > 0) {
      storeActions.setServers(cfg.servers);
    }
  });

  // ── Discovery ────────────────────────────────────────────────────────────
  // When discovery is enabled, scan sequential ports starting from the first
  // server's URL and update store.servers with whatever responds.

  async function runDiscovery() {
    const cfg = config();
    if (!cfg.discovery?.enabled) return;

    const seed = cfg.server ?? cfg.servers[0];
    if (!seed) return;

    const discovered = await discoverReplicas({
      baseUrl: seed.url,
      ...(seed.name !== undefined && { baseName: seed.name }),
      ...(cfg.discovery.maxReplicas !== undefined && { maxReplicas: cfg.discovery.maxReplicas }),
      ...(cfg.discovery.timeout !== undefined && { timeout: cfg.discovery.timeout }),
      jsonp: settings.jsonp,
    });

    if (discovered.length > 0) {
      storeActions.setServers(discovered);
    }
  }

  // Run discovery once when monitoring becomes active.
  createEffect(() => {
    if (store.active && config().discovery?.enabled) {
      runDiscovery();
    }
  });

  // Re-scan on a configurable interval so new replicas appear automatically
  // and removed ones disappear. Restarts when the interval setting changes.
  createEffect(() => {
    const cfg = config();
    if (!store.active || !cfg.discovery?.enabled) return;

    const ms = cfg.discovery.interval ?? 30_000;
    if (ms <= 0) return;

    const id = setInterval(runDiscovery, ms);
    onCleanup(() => clearInterval(id));
  });

  return (
    <Transition
      enterActiveClass="ease-in duration-300"
      enterClass="opacity-0"
      enterToClass="opacity-100"
      // Prevent a page jump when removing the loading indicator.
      exitActiveClass="hidden"
    >
      <Show
        when={!config.loading}
        fallback={
          <div class="flex items-center justify-center min-h-screen text-gray-900 dark:text-white">
            <LoadingIcon class="h-10 w-10" />
          </div>
        }
      >
        <div>
          <InputHeader />

          <main>
            <Navigation />
            {props.children}
          </main>
        </div>
      </Show>
    </Transition>
  );
}
