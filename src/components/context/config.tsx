import {
  createContext,
  useContext,
  createResource,
  type ParentProps,
  type InitializedResource,
} from 'solid-js';

export interface Server {
  /** Server display name (Optional). */
  name?: string;
  /** NATS monitoring server URL. */
  url: string;
}

export interface DiscoveryConfig {
  /**
   * Enable automatic replica discovery.
   *
   * When enabled the dashboard probes sequential ports starting from the first
   * server in `servers` (e.g. :8222, :8223, :8224 …) and adds every reachable
   * NATS instance to the replica list automatically.
   */
  enabled: boolean;
  /**
   * Upper bound on the number of replicas to probe.
   *
   * Scanning also stops at the first unreachable port, so in practice fewer
   * requests are made. @default 20
   */
  maxReplicas?: number;
  /**
   * Per-probe timeout in milliseconds.
   *
   * Keep this short — connection-refused on localhost is near-instant.
   * Increase only if your replicas are behind a remote firewall. @default 2000
   */
  timeout?: number;
  /**
   * How often (in ms) to re-scan for new / removed replicas while monitoring
   * is active. Set to 0 to disable periodic re-scan. @default 30000
   */
  interval?: number;
}

export interface Config {
  /** Default NATS server. */
  server?: Server;
  /** Default NATS servers list (also used as seed for discovery). */
  servers: Server[];
  /**
   * Hide the server URL input.
   *
   * Disables the query params.
   * Useful for instances monitoring a single NATS server.
   */
  hideServerInput: boolean;
  /**
   * Automatic replica discovery via sequential port scanning.
   *
   * When enabled, the static `servers` list is replaced at runtime by
   * whatever is reachable starting from the first server's port.
   */
  discovery?: DiscoveryConfig;
}

const defaultConfig = {
  hideServerInput: false,
  servers: [
    {
      name: 'localhost',
      url: 'http://localhost:8222',
    },
  ],
};

interface InitialConfigContext {
  state: 'refreshing';
  loading: true;
  error: undefined;
  latest: Config;
  (): Config;
}

const defaultResource: InitialConfigContext = () => defaultConfig;
defaultResource.state = 'refreshing';
defaultResource.loading = true;
defaultResource.error = undefined;
defaultResource.latest = defaultConfig;

const ConfigContext =
  createContext<InitializedResource<Config>>(defaultResource);

async function fetchConfig() {
  const response = await fetch('/config.json');
  const config: Config = await response.json();
  return { ...defaultConfig, ...config };
}

export function ConfigProvider(props: ParentProps) {
  const [config] = createResource(fetchConfig, { initialValue: defaultConfig });

  return (
    <ConfigContext.Provider value={config}>
      {props.children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
