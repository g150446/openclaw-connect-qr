# openclaw-connect-qr

OpenClaw plugin that prints a QR code for connecting a phone app to this
Gateway's **HTTP API** (`/v1/chat/completions`, `/v1/models`, `/tools/invoke`).
The app scans it once and gets the URL and secret. Nobody has to type them.

Why not `openclaw qr`? The built-in command pairs a device over the Gateway
Protocol (WebSocket, device keys, bootstrap token). The HTTP endpoints accept
only the shared gateway token or password, so a plain HTTP client cannot use a
setup code. This plugin covers that case.

## Install

```sh
git clone https://github.com/g150446/openclaw-connect-qr.git
cd openclaw-connect-qr && npm install
openclaw plugins install --link "$PWD"
```

## Use

```sh
openclaw connect-qr                      # QR in the terminal
openclaw connect-qr --agent openclaw/main
openclaw connect-qr --url http://my-mac.tailnet.ts.net:18789
openclaw connect-qr --uri-only           # just the URI (contains the secret)
openclaw connect-qr --json               # fields without the secret
```

The command checks:

- `gateway.http.endpoints.chatCompletions.enabled` is `true`. If it is off, the
  command prints the fix and exits with status 1.
- `gateway.auth.mode` is `token` or `password`. The secret is read from
  `gateway.auth.token` or `gateway.auth.password`: a plain value, an env
  SecretRef, or `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD`.
- The address the phone uses. In order: `--url`, `customBindHost`, the
  Tailscale IPv4, then a private LAN IPv4. If `gateway.bind` is `loopback` (the
  default), the phone cannot reach the Gateway, so the command warns and shows
  how to switch to `tailnet`.

## Connect URI v1

```
openclaw-connect://http?v=1&url=<base>&auth=token|password&secret=<secret>[&agent=<target>][&name=<host>]
```

All values are URL-encoded (`application/x-www-form-urlencoded`).

| field    | meaning |
|----------|---------|
| `v`      | Always `1`. Reject anything else. |
| `url`    | Gateway HTTP base, `http(s)://host:port`, with no trailing slash |
| `auth`   | `token` or `password`. Informational only: both are sent as `Authorization: Bearer <secret>` |
| `secret` | The shared gateway token or password |
| `agent`  | Optional agent target (`openclaw/<id>`) for the `model` field |
| `name`   | Optional display name of the Gateway host |

A client should store the secret in its platform keystore and never log it.
`src/payload.ts` parses this format and can serve as a reference.

## Security

The QR code holds the shared operator secret, which gives full operator access
to the Gateway. Show it only to your own phone, and do not screenshot it or
share it on a call. Keep the Gateway on a tailnet or LAN, and never expose it
to the public internet. To revoke access, rotate `gateway.auth.token`.
