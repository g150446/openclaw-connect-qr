/**
 * Connect URI v1: everything an HTTP client needs to talk to a Gateway.
 *
 *   openclaw-connect://http?v=1&url=<base>&auth=token|password&secret=<secret>[&agent=<target>][&name=<host>]
 *
 * `url` is the Gateway's HTTP base (no trailing slash). `secret` goes in
 * `Authorization: Bearer <secret>` whichever `auth` mode it came from; `auth`
 * is only there so a client can label it.
 */

export const CONNECT_SCHEME = "openclaw-connect";
export const CONNECT_VERSION = "1";

export type ConnectAuth = "token" | "password";

export type ConnectPayload = {
  url: string;
  auth: ConnectAuth;
  secret: string;
  agent?: string;
  name?: string;
};

export function buildConnectUri(payload: ConnectPayload): string {
  const params = new URLSearchParams();
  params.set("v", CONNECT_VERSION);
  params.set("url", normalizeBaseUrl(payload.url));
  params.set("auth", payload.auth);
  params.set("secret", payload.secret);
  if (payload.agent) params.set("agent", payload.agent);
  if (payload.name) params.set("name", payload.name);
  return `${CONNECT_SCHEME}://http?${params.toString()}`;
}

/** Throws with a message that never contains the secret. */
export function parseConnectUri(raw: string): ConnectPayload {
  const text = raw.trim();
  const prefix = `${CONNECT_SCHEME}://http?`;
  if (!text.startsWith(prefix)) throw new Error(`not an ${CONNECT_SCHEME} URI`);
  const params = new URLSearchParams(text.slice(prefix.length));
  if (params.get("v") !== CONNECT_VERSION) throw new Error(`unsupported version: ${params.get("v") ?? "(none)"}`);
  const url = normalizeBaseUrl(params.get("url") ?? "");
  if (!/^https?:\/\/[^/]+/.test(url)) throw new Error("url must be http(s)");
  const auth = params.get("auth");
  if (auth !== "token" && auth !== "password") throw new Error("auth must be token or password");
  const secret = params.get("secret") ?? "";
  if (!secret) throw new Error("secret is missing");
  const agent = params.get("agent") || undefined;
  const name = params.get("name") || undefined;
  return { url, auth, secret, agent, name };
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}
