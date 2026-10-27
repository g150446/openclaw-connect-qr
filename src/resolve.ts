import type { ConnectAuth, ConnectPayload } from "./payload.ts";

/** The slice of `openclaw.json` this plugin reads. */
export type GatewaySlice = {
  port?: number;
  bind?: string;
  customBindHost?: string;
  tls?: { enabled?: boolean };
  tailscale?: { mode?: string };
  auth?: {
    mode?: string;
    token?: unknown;
    password?: unknown;
  };
  http?: { endpoints?: { chatCompletions?: { enabled?: boolean } } };
};

export type ResolveOptions = {
  url?: string;
  agent?: string;
  name?: string;
};

export type HostProbe = {
  tailscaleIp: () => string | undefined;
  /** MagicDNS name of this machine, e.g. `mac.tailnet.ts.net`. */
  tailscaleDnsName: () => string | undefined;
  lanIp: () => string | undefined;
  env: Record<string, string | undefined>;
};

export type Resolved = { payload: ConnectPayload; warnings: string[] };

export const DEFAULT_PORT = 18789;

export class SetupError extends Error {}

export function resolveConnect(gateway: GatewaySlice | undefined, options: ResolveOptions, probe: HostProbe): Resolved {
  const g = gateway ?? {};
  const warnings: string[] = [];

  if (g.http?.endpoints?.chatCompletions?.enabled !== true) {
    throw new SetupError(
      "The Gateway's /v1/chat/completions endpoint is off. Turn it on, then run this again:\n" +
        "  openclaw config set gateway.http.endpoints.chatCompletions.enabled true\n" +
        "  openclaw gateway restart",
    );
  }

  const { auth, secret } = resolveSecret(g, probe.env);
  const url = options.url ?? guessUrl(g, probe, warnings);

  return {
    payload: { url, auth, secret, agent: options.agent, name: options.name },
    warnings,
  };
}

function resolveSecret(g: GatewaySlice, env: Record<string, string | undefined>): { auth: ConnectAuth; secret: string } {
  const mode = g.auth?.mode ?? (g.auth?.password !== undefined && g.auth?.token === undefined ? "password" : "token");
  if (mode !== "token" && mode !== "password") {
    throw new SetupError(
      `gateway.auth.mode is "${mode}". A QR code can only carry a shared token or password; ` +
        "use token or password mode for HTTP clients.",
    );
  }
  const input = mode === "token" ? g.auth?.token : g.auth?.password;
  const envName = mode === "token" ? "OPENCLAW_GATEWAY_TOKEN" : "OPENCLAW_GATEWAY_PASSWORD";
  const secret = secretValue(input, env) ?? env[envName];
  if (!secret) {
    throw new SetupError(
      `Could not read the gateway ${mode}. Set gateway.auth.${mode} (a plain value or an env SecretRef) ` +
        `or export ${envName} before running this.`,
    );
  }
  return { auth: mode, secret };
}

/** Plain strings and env SecretRefs; other providers (files, vaults) are left to the env fallback. */
function secretValue(input: unknown, env: Record<string, string | undefined>): string | undefined {
  if (typeof input === "string") return input.trim() || undefined;
  if (input && typeof input === "object") {
    const ref = input as { source?: unknown; id?: unknown };
    if (ref.source === "env" && typeof ref.id === "string") return env[ref.id]?.trim() || undefined;
  }
  return undefined;
}

function guessUrl(g: GatewaySlice, probe: HostProbe, warnings: string[]): string {
  // Managed Serve/Funnel keeps the Gateway on loopback and fronts it with HTTPS on the MagicDNS name.
  const tailscaleMode = g.tailscale?.mode;
  if (tailscaleMode === "serve" || tailscaleMode === "funnel") {
    const dnsName = probe.tailscaleDnsName();
    if (!dnsName) {
      throw new SetupError(
        `gateway.tailscale.mode is "${tailscaleMode}" but this Mac's Tailscale name could not be read. ` +
          "Pass it with --url https://<name>.ts.net",
      );
    }
    if (tailscaleMode === "funnel") {
      warnings.push("gateway.tailscale.mode is \"funnel\": this URL is reachable from the public internet.");
    }
    return `https://${dnsName}`;
  }

  const scheme = g.tls?.enabled ? "https" : "http";
  const port = g.port ?? DEFAULT_PORT;
  const bind = g.bind ?? "loopback";

  let host: string | undefined;
  switch (bind) {
    case "custom":
      host = g.customBindHost;
      break;
    case "tailnet":
      host = probe.tailscaleIp();
      break;
    case "lan":
      host = probe.tailscaleIp() ?? probe.lanIp();
      break;
    default:
      warnings.push(
        `gateway.bind is "${bind}", so the Gateway only listens on this Mac and a phone cannot reach it. ` +
          'Set it to "tailnet" (recommended) or "lan" and restart the Gateway: ' +
          "openclaw config set gateway.bind tailnet && openclaw gateway restart",
      );
      host = probe.tailscaleIp() ?? probe.lanIp();
  }
  if (!host) {
    throw new SetupError("Could not work out an address the phone can reach. Pass it with --url http://<host>:" + port);
  }
  return `${scheme}://${host}:${port}`;
}
