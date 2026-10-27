import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectUri, parseConnectUri } from "../src/payload.ts";
import { resolveConnect, SetupError, type GatewaySlice, type HostProbe } from "../src/resolve.ts";

test("round-trips a payload, escaping reserved characters", () => {
  const payload = {
    url: "http://100.64.0.1:18789",
    auth: "token" as const,
    secret: "a&b=c?d/e+f g",
    agent: "openclaw/main",
    name: "my-mac",
  };
  const uri = buildConnectUri(payload);
  assert.ok(uri.startsWith("openclaw-connect://http?v=1&"));
  assert.deepEqual(parseConnectUri(uri), payload);
});

test("drops a trailing slash from the url", () => {
  const uri = buildConnectUri({ url: "http://host:18789/", auth: "token", secret: "s" });
  assert.equal(parseConnectUri(uri).url, "http://host:18789");
});

test("rejects other schemes, versions and missing fields without echoing the secret", () => {
  assert.throws(() => parseConnectUri("harbor://pair?x=1"), /not an openclaw-connect URI/);
  assert.throws(() => parseConnectUri("openclaw-connect://http?v=2&url=http://h&auth=token&secret=s"), /version/);
  assert.throws(() => parseConnectUri("openclaw-connect://http?v=1&url=ftp://h&auth=token&secret=s"), /http/);
  assert.throws(() => parseConnectUri("openclaw-connect://http?v=1&url=http://h&auth=token"), /secret/);
  assert.throws(
    () => parseConnectUri("openclaw-connect://http?v=1&url=http://h&auth=bearer&secret=TOPSECRET"),
    (error: Error) => !error.message.includes("TOPSECRET"),
  );
});

const probe = (overrides: Partial<HostProbe> = {}): HostProbe => ({
  tailscaleIp: () => "100.64.0.1",
  tailscaleDnsName: () => "my-mac.tailnet.ts.net",
  lanIp: () => "192.168.1.10",
  env: {},
  ...overrides,
});

const enabled: GatewaySlice = {
  bind: "tailnet",
  auth: { mode: "token", token: "tok" },
  http: { endpoints: { chatCompletions: { enabled: true } } },
};

test("uses the tailnet address and the plain token", () => {
  const { payload, warnings } = resolveConnect(enabled, {}, probe());
  assert.equal(payload.url, "http://100.64.0.1:18789");
  assert.equal(payload.secret, "tok");
  assert.deepEqual(warnings, []);
});

test("refuses when chat completions are off", () => {
  assert.throws(() => resolveConnect({ ...enabled, http: {} }, {}, probe()), SetupError);
});

test("reads env SecretRefs and the env fallback", () => {
  const ref = { ...enabled, auth: { mode: "token", token: { source: "env", provider: "default", id: "MY_TOKEN" } } };
  assert.equal(resolveConnect(ref, {}, probe({ env: { MY_TOKEN: "from-ref" } })).payload.secret, "from-ref");
  const none = { ...enabled, auth: { mode: "token" } };
  assert.equal(resolveConnect(none, {}, probe({ env: { OPENCLAW_GATEWAY_TOKEN: "from-env" } })).payload.secret, "from-env");
  assert.throws(() => resolveConnect(none, {}, probe()), SetupError);
});

test("warns on a loopback bind and honours --url", () => {
  const loopback = { ...enabled, bind: "loopback" };
  assert.equal(resolveConnect(loopback, {}, probe()).warnings.length, 1);
  assert.equal(resolveConnect(loopback, { url: "http://mac.local:18789" }, probe()).payload.url, "http://mac.local:18789");
});

test("uses the MagicDNS HTTPS name when Tailscale Serve fronts a loopback Gateway", () => {
  const serve = { ...enabled, bind: "loopback", tailscale: { mode: "serve" } };
  const { payload, warnings } = resolveConnect(serve, {}, probe());
  assert.equal(payload.url, "https://my-mac.tailnet.ts.net");
  assert.deepEqual(warnings, []);
  assert.throws(() => resolveConnect(serve, {}, probe({ tailscaleDnsName: () => undefined })), SetupError);
});
