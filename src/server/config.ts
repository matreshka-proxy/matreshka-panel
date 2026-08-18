import { join, resolve } from "node:path";
import { version } from "../version";

const production = process.env.NODE_ENV === "production";
const projectRoot = resolve(import.meta.dir, "..", "..");
const dataDir = resolve(process.env.MATRESHKA_DATA_DIR ?? (production ? "/var/lib/matreshka" : join(projectRoot, ".data")));
const configDir = resolve(process.env.MATRESHKA_CONFIG_DIR ?? (production ? "/etc/matreshka" : join(projectRoot, ".data", "config")));

const listen = process.env.MATRESHKA_LISTEN ?? "127.0.0.1:8181";
const [hostname, rawPort] = listen.split(":");
const domain = process.env.MATRESHKA_DOMAIN ?? "localhost";
const adminPath = normalizePath(process.env.MATRESHKA_ADMIN_PATH ?? "/admin");

export const config = {
  version: process.env.MATRESHKA_VERSION ?? version,
  production,
  demo: process.env.MATRESHKA_DEMO === "1",
  setup: process.env.MATRESHKA_SETUP === "1",
  dataDir,
  configDir,
  databasePath: join(dataDir, "matreshka.sqlite"),
  masterKeyPath: join(dataDir, "master.key"),
  webRoot: resolve(process.env.MATRESHKA_WEB_ROOT ?? join(projectRoot, "public")),
  hostname: hostname || "127.0.0.1",
  port: Number(rawPort || "8181"),
  domain,
  publicIp: process.env.MATRESHKA_PUBLIC_IP ?? (isIPv4(domain) ? domain : ""),
  adminPath,
  rpID: process.env.MATRESHKA_RP_ID ?? domain,
  origin: process.env.MATRESHKA_ORIGIN ?? (domain === "localhost" ? `http://localhost:${rawPort || "8181"}` : `https://${domain}`),
  xhttpPath: normalizePath(process.env.MATRESHKA_XHTTP_PATH ?? "/xhttp-change-me"),
  hysteriaStatsSecret: process.env.MATRESHKA_HYSTERIA_STATS_SECRET ?? "development-stats-secret",
  agentSocket: process.env.MATRESHKA_AGENT_SOCKET ?? "/run/matreshka/agent.sock",
  sessionHours: 24 * 30,
  invitationHours: 72,
  redemptionHours: 24,
} as const;

function normalizePath(value: string) {
  const trimmed = value.trim().replace(/\/{2,}/g, "/");
  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return prefixed.length > 1 ? prefixed.replace(/\/$/, "") : prefixed;
}

function isIPv4(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
