import { execFileSync } from "node:child_process";
import { hostname, networkInterfaces } from "node:os";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildConnectUri } from "./payload.ts";
import { resolveConnect, SetupError, type GatewaySlice, type HostProbe } from "./resolve.ts";

const COMMAND = {
  name: "connect-qr",
  description: "Show a QR code for connecting a phone app to this Gateway's HTTP API",
  hasSubcommands: false,
};

type CliOptions = { url?: string; agent?: string; json?: boolean; uriOnly?: boolean };

export default definePluginEntry({
  id: "connect-qr",
  name: "Connect QR",
  description: "Show a QR code that lets a phone app connect to this Gateway's HTTP API.",
  register(api) {
    api.registerCli(
      ({ program, config }) => {
        program
          .command(COMMAND.name)
          .description(COMMAND.description)
          .option("--url <url>", "Gateway URL the phone should use (default: Tailscale IP, then LAN IP)")
          .option("--agent <target>", "Agent target to suggest to the app, e.g. openclaw/main")
          .option("--json", "Print the connect URI and fields as JSON instead of a QR code")
          .option("--uri-only", "Print only the connect URI")
          .action(async (options: CliOptions) => {
            const gateway = (config as { gateway?: GatewaySlice }).gateway;
            await run(gateway, options);
          });
      },
      { descriptors: [COMMAND] },
    );
  },
});

async function run(gateway: GatewaySlice | undefined, options: CliOptions): Promise<void> {
  let resolved;
  try {
    resolved = resolveConnect(gateway, { url: options.url, agent: options.agent, name: hostname().replace(/\.local$/, "") }, hostProbe());
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const uri = buildConnectUri(resolved.payload);
  for (const warning of resolved.warnings) console.error(`warning: ${warning}`);

  if (options.uriOnly) {
    console.log(uri);
    return;
  }
  if (options.json) {
    const { secret: _secret, ...fields } = resolved.payload;
    console.log(JSON.stringify({ uri, ...fields }, null, 2));
    return;
  }

  const qrcode = (await import("qrcode-terminal")).default;
  qrcode.generate(uri, { small: true }, (code: string) => console.log(code));
  console.log(`Gateway: ${resolved.payload.url}`);
  if (resolved.payload.agent) console.log(`Agent:   ${resolved.payload.agent}`);
  console.log(
    "\nThis QR code carries the Gateway's shared operator secret. Scan it only with your own phone, " +
      "and do not screenshot it or show it on a shared screen.",
  );
}

function hostProbe(): HostProbe {
  return {
    tailscaleIp: () => {
      for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
        try {
          const out = execFileSync(bin, ["ip", "-4"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
          const ip = out.split("\n").map((line) => line.trim()).find(Boolean);
          if (ip) return ip;
        } catch {
          // Not installed or not logged in; try the next one.
        }
      }
      return undefined;
    },
    lanIp: () => {
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.family === "IPv4" && !address.internal && isPrivateIpv4(address.address)) return address.address;
        }
      }
      return undefined;
    },
    env: process.env,
  };
}

function isPrivateIpv4(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}
