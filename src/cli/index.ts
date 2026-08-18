#!/usr/bin/env bun
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { MatreshkaDatabase } from "../server/db/database";
import { AuthService } from "../server/auth/webauthn";
import { MatreshkaApi, apiFromEnvironment } from "./api";
import { runMcp } from "./mcp";

const [command = "help", ...args] = Bun.argv.slice(2);

try {
  switch (command) {
    case "mcp":
      await runMcp();
      break;
    case "doctor":
      await doctor(args);
      break;
    case "deploy":
      await deploy(args);
      break;
    case "update":
      await update(args);
      break;
    case "backup":
      await backup(args);
      break;
    case "restore":
      await restore(args);
      break;
    case "bootstrap-reset":
      resetBootstrap(args);
      break;
    case "migrate":
      migrate(args);
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      throw new Error(`Неизвестная команда: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function doctor(args: string[]) {
  const url = option(args, "--url") ?? process.env.MATRESHKA_URL;
  if (!url) throw new Error("doctor требует --url или MATRESHKA_URL");
  const api = new MatreshkaApi({ url, token: process.env.MATRESHKA_TOKEN });
  const started = performance.now();
  const health = await api.get<{ ok: boolean; version: string }>("/healthz");
  const ready = await api.get<{ ok: boolean }>("/readyz");
  console.log(JSON.stringify({ url, latencyMs: Math.round(performance.now() - started), health, ready }, null, 2));
}

async function deploy(args: string[]) {
  const target = args.find((value) => !value.startsWith("-"));
  if (!target) throw new Error("Использование: matreshkactl deploy root@server");
  if (!/^root@[^\s]+$/.test(target)) throw new Error("Первая установка выполняется от root: root@server");
  const root = repositoryRoot();
  const script = resolve(root, "infra/scripts/deploy-remote");
  accessSync(script, constants.X_OK);
  await run([script, target]);
}

function repositoryRoot() {
  const candidates = [
    process.env.MATRESHKA_SOURCE_DIR,
    process.cwd(),
    resolve(import.meta.dir, "..", ".."),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      accessSync(resolve(candidate, "infra/scripts/deploy-remote"), constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Не найден исходный monorepo. Запустите deploy из корня matreshka-panel или задайте MATRESHKA_SOURCE_DIR.");
}

async function update(args: string[]) {
  const target = args.find((value) => !value.startsWith("-"));
  const bundle = option(args, "--bundle");
  const signature = option(args, "--signature") ?? (bundle ? `${bundle}.minisig` : undefined);
  if (!target || !bundle || !signature) throw new Error("Использование: matreshkactl update root@server --bundle release.tar.gz [--signature release.tar.gz.minisig]");
  await run(["scp", bundle, `${target}:/var/lib/matreshka/incoming/update.tar.gz`]);
  await run(["scp", signature, `${target}:/var/lib/matreshka/incoming/update.tar.gz.minisig`]);
  await run([
    "ssh", target, "/opt/matreshka/current/infra/scripts/apply-update",
    "/var/lib/matreshka/incoming/update.tar.gz", "/var/lib/matreshka/incoming/update.tar.gz.minisig",
  ]);
}

async function backup(args: string[]) {
  const [subcommand, output] = args;
  if (subcommand !== "export" || !output) throw new Error("Использование: matreshkactl backup export /path/backup.age");
  await run(["/opt/matreshka/current/infra/scripts/export-backup", resolve(output)]);
}

async function restore(args: string[]) {
  const [archive] = args;
  if (!archive) throw new Error("Использование: matreshkactl restore /path/backup.age");
  await run(["/opt/matreshka/current/infra/scripts/restore-backup", resolve(archive)]);
}

function resetBootstrap(args: string[]) {
  const path = option(args, "--database") ?? process.env.MATRESHKA_DATABASE ?? "/var/lib/matreshka/matreshka.sqlite";
  const db = new MatreshkaDatabase(path);
  try { console.log(new AuthService(db).resetBootstrap()); } finally { db.close(); }
}

function migrate(args: string[]) {
  const path = option(args, "--database") ?? process.env.MATRESHKA_DATABASE ?? "/var/lib/matreshka/matreshka.sqlite";
  const db = new MatreshkaDatabase(path);
  try { console.log(`Миграции применены: ${path}`); } finally { db.close(); }
}

async function run(argv: string[]) {
  const process = Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await process.exited;
  if (code !== 0) throw new Error(`Команда завершилась с кодом ${code}: ${argv[0]}`);
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function help() {
  console.log(`Matreshka CLI

matreshkactl doctor --url https://proxy.example.com
matreshkactl deploy root@server
matreshkactl update root@server --bundle release.tar.gz [--signature release.tar.gz.minisig]
matreshkactl backup export backup.age
matreshkactl restore backup.age
matreshkactl bootstrap-reset [--database /var/lib/matreshka/matreshka.sqlite]
matreshkactl migrate [--database /var/lib/matreshka/matreshka.sqlite]
matreshkactl mcp

MCP/API: MATRESHKA_URL and MATRESHKA_TOKEN.
`);
}
