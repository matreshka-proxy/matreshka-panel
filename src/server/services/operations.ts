import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import type { MatreshkaDatabase } from "../db/database";
import { addHours, now } from "../db/database";
import { config } from "../config";
import { ServiceError } from "./people";
import type { PeopleService } from "./people";
import type { EngineRuntimeService } from "./engine-runtime";
import type { DeviceSyncService } from "./device-sync";
import { JournalService } from "./journal";

export type PrivilegedAction = "device.revoke" | "service.restart" | "service.start" | "service.stop" | "engine.update" | "nginx.reload" | "update.apply" | "backup.export";

const previews: Record<PrivilegedAction, (payload: Record<string, unknown>) => unknown> = {
  "device.revoke": (payload) => ({
    title: "Отозвать устройство",
    changes: ["Credentials обоих движков и подписка устройства будут немедленно отозваны"],
    payload,
  }),
  "service.restart": (payload) => ({
    title: "Перезапустить службу",
    changes: [`Служба ${String(payload.service ?? "")} будет кратковременно недоступна`],
    payload,
  }),
  "service.start": (payload) => ({
    title: `Запустить ${serviceLabel(payload.service)}`,
    changes: [`${serviceLabel(payload.service)} снова начнёт принимать подключения`],
    payload,
  }),
  "service.stop": (payload) => ({
    title: `Остановить ${serviceLabel(payload.service)}`,
    changes: [`Текущие подключения через ${serviceLabel(payload.service)} прервутся, а новые перейдут к следующему способу по порядку`],
    payload,
  }),
  "engine.update": (payload) => ({
    title: `Обновить ${String(payload.engine) === "xray" ? "Xray" : "Hysteria 2"} до ${String(payload.version ?? "")}`,
    changes: ["Архив будет проверен по SHA-256, затем перезапустится только выбранный движок"],
    payload,
  }),
  "nginx.reload": (payload) => ({ title: "Проверить и перечитать Nginx", changes: ["Сначала будет выполнен nginx -t"], payload }),
  "update.apply": (payload) => ({
    title: "Обновить Matreshka",
    changes: ["Подпись Minisign будет проверена до распаковки", "Будет создан снимок SQLite", "Туннельные движки продолжат работать"],
    payload,
  }),
  "backup.export": (payload) => ({
    title: "Создать резервную копию",
    changes: [payload.passphrase ? "Архив будет защищён отдельным паролем" : "Архив будет создан без шифрования"],
    payload,
  }),
};

export class OperationService {
  private listeners = new Set<(event: unknown) => void>();
  private journal: JournalService;

  constructor(
    private db: MatreshkaDatabase,
    private people?: PeopleService,
    private engines?: EngineRuntimeService,
    journal?: JournalService,
    private runner: typeof callAgent = callAgent,
    private deviceSync?: DeviceSyncService,
  ) {
    this.journal = journal ?? new JournalService(db);
  }

  list() {
    return this.db.raw.query<{
      id: string; kind: string; status: string; progress: number; message: string; result_json: string | null;
      error: string | null; created_at: string; updated_at: string;
    }, []>("SELECT * FROM operations ORDER BY created_at DESC LIMIT 50").all().map((row) => ({
      ...row,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      result_json: undefined,
    }));
  }

  preview(action: PrivilegedAction, payload: Record<string, unknown>, actor = "owner") {
    const render = previews[action];
    if (!render) throw new ServiceError(400, "Операция не разрешена");
    this.validate(action, payload);
    const safePayload = redactPayload(action, payload);
    const preview = render(safePayload);
    const id = crypto.randomUUID();
    const hash = payloadHash(action, payload);
    this.db.raw.query(`
      INSERT INTO confirmations (id, action, payload_hash, preview_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, action, hash, JSON.stringify(preview), addHours(0.17), now());
    this.db.audit({ actor, action: `${action}.preview`, resource: "confirmation", resourceId: id, after: preview });
    return { confirmationId: id, action, preview, expiresAt: addHours(0.17) };
  }

  confirm(confirmationId: string, action: PrivilegedAction, payload: Record<string, unknown>, actor = "owner") {
    const row = this.db.raw.query<{ id: string; action: string; payload_hash: string; expires_at: string; used_at: string | null }, string>(
      "SELECT id, action, payload_hash, expires_at, used_at FROM confirmations WHERE id = ?",
    ).get(confirmationId);
    if (!row || row.used_at || row.expires_at <= now() || row.action !== action || row.payload_hash !== payloadHash(action, payload)) {
      throw new ServiceError(409, "Подтверждение недействительно, истекло или не соответствует операции");
    }
    this.validate(action, payload);
    const operation = { id: crypto.randomUUID(), kind: action, status: "queued", progress: 0, message: "Операция поставлена в очередь" };
    this.db.raw.transaction(() => {
      this.db.raw.query("UPDATE confirmations SET used_at = ? WHERE id = ?").run(now(), confirmationId);
      this.db.raw.query(`
        INSERT INTO operations (id, kind, status, progress, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(operation.id, operation.kind, operation.status, operation.progress, operation.message, now(), now());
      const auditId = this.db.audit({ actor, action: `${action}.confirm`, resource: "operation", resourceId: operation.id, after: redactPayload(action, payload) });
      const startedType = operationEvent(action, "started");
      if (startedType) {
        this.journal.record(startedType, {
          actor,
          auditId,
          operationId: operation.id,
          subjectType: operationSubject(action),
          subjectId: operationSubjectId(action, payload),
          data: operationData(action, payload),
        });
      }
    })();
    void this.execute(operation.id, action, payload, actor);
    return operation;
  }

  subscribe(listener: (event: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async execute(id: string, action: PrivilegedAction, payload: Record<string, unknown>, actor: string) {
    try {
      this.update(id, "running", 15, action === "device.revoke" ? "Отзываем credentials устройства" : "Передаём операцию root-agent");
      const result = action === "device.revoke"
        ? await this.revoke(String(payload.deviceId))
        : config.demo
          ? await new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({ ok: true, demo: true }), 350))
          : await this.runner({ action, payload });
      if (action === "engine.update") {
        this.db.raw.query("UPDATE engine_versions SET installed_version = ?, updated_at = ? WHERE engine = ?")
          .run(String(payload.version), now(), String(payload.engine));
      }
      if (config.demo && (action === "service.start" || action === "service.stop")) {
        this.demoService(String(payload.service), action === "service.start");
      }
      this.update(id, "completed", 100, "Готово", result);
      const completedType = operationEvent(action, "completed");
      if (completedType) {
        this.journal.record(completedType, {
          actor,
          operationId: id,
          subjectType: operationSubject(action),
          subjectId: operationSubjectId(action, payload),
          data: { ...operationData(action, payload), ...operationResultData(action, result, payload) },
        });
      }
    } catch (error) {
      this.db.raw.query("UPDATE operations SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(String(error), now(), id);
      this.emit({ id, status: "failed", error: String(error) });
      const failedType = operationEvent(action, "failed");
      if (failedType) {
        this.journal.record(failedType, {
          actor,
          operationId: id,
          subjectType: operationSubject(action),
          subjectId: operationSubjectId(action, payload),
          data: { ...operationData(action, payload), error: safeError(error) },
        });
      }
    }
  }

  private update(id: string, status: string, progress: number, message: string, result?: unknown) {
    this.db.raw.query(`
      UPDATE operations SET status = ?, progress = ?, message = ?, result_json = ?, updated_at = ? WHERE id = ?
    `).run(status, progress, message, result === undefined ? null : JSON.stringify(result), now(), id);
    this.emit({ id, status, progress, message, result });
  }

  private emit(event: unknown) {
    for (const listener of this.listeners) listener(event);
  }

  private validate(action: PrivilegedAction, payload: Record<string, unknown>) {
    if (action === "device.revoke") {
      const id = String(payload.deviceId ?? "");
      const device = this.db.raw.query<{ status: string }, string>("SELECT status FROM devices WHERE id = ?").get(id);
      if (!device) throw new ServiceError(404, "Устройство не найдено");
      if (device.status === "revoked") throw new ServiceError(409, "Устройство уже отозвано");
    }
    if (action === "service.restart") {
      const services = ["matreshka", "nginx", "hysteria-server", "xray"];
      if (!services.includes(String(payload.service))) throw new ServiceError(400, "Эту службу нельзя перезапустить");
    }
    if (action === "service.start" || action === "service.stop") {
      const services = ["hysteria-server", "xray"];
      if (!services.includes(String(payload.service))) throw new ServiceError(400, "Эту службу нельзя запускать или останавливать");
    }
    if (action === "engine.update") {
      const engine = String(payload.engine ?? "");
      const version = String(payload.version ?? "");
      const checksum = String(payload.checksum ?? "");
      if (!['hysteria', 'xray'].includes(engine)) throw new ServiceError(400, "Неизвестный движок");
      if (!/^[0-9][0-9A-Za-z.-]{0,39}$/.test(version)) throw new ServiceError(400, "Некорректная версия движка");
      if (!/^[0-9a-f]{64}$/.test(checksum)) throw new ServiceError(400, "Некорректная контрольная сумма");
      const pinned = this.db.raw.query<{ installed_version: string | null; desired_version: string; checksum: string }, string>(
        "SELECT installed_version, desired_version, checksum FROM engine_versions WHERE engine = ?",
      ).get(engine);
      if (!pinned || pinned.desired_version !== version || pinned.checksum !== checksum) {
        throw new ServiceError(409, "Версия не совпадает с закреплённым обновлением");
      }
      if (pinned.installed_version === version) throw new ServiceError(409, "Эта версия уже установлена");
    }
    if (action === "update.apply") {
      const version = String(payload.version ?? "");
      const bundle = String(payload.bundle ?? "");
      const signature = String(payload.signature ?? "");
      if (!/^[0-9][0-9A-Za-z.-]{0,39}$/.test(version)) throw new ServiceError(400, "Некорректная версия Matreshka");
      if (!/^\/var\/lib\/matreshka\/incoming\/[0-9A-Za-z._-]+\.tar\.gz$/.test(bundle)) {
        throw new ServiceError(400, "Некорректный путь release archive");
      }
      if (signature !== `${bundle}.minisig`) throw new ServiceError(400, "Подпись должна соответствовать release archive");
    }
    if (action === "backup.export") {
      const passphrase = payload.passphrase;
      if (passphrase !== undefined && (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 200)) {
        throw new ServiceError(400, "Пароль должен содержать от 12 до 200 символов");
      }
      if (!/^\/var\/lib\/matreshka\/backups\/matreshka-[0-9a-f-]+\.(age|tar)$/.test(String(payload.output ?? ""))) {
        throw new ServiceError(400, "Некорректный путь резервной копии");
      }
    }
  }

  private async revoke(id: string) {
    if (!this.deviceSync) throw new Error("Device sync is not initialized");
    await this.deviceSync.revoke(id, "operation");
    return { ok: true, deviceId: id };
  }

  private demoService(service: string, active: boolean) {
    const overrides = this.db.setting<Record<string, boolean>>("demo_service_states", {});
    this.db.setSetting("demo_service_states", { ...overrides, [service]: active });
    const snapshot = this.db.setting<{ services?: Array<{ name: string; status: string }>; [key: string]: unknown }>("monitor_snapshot", {});
    const services = snapshot.services ?? ["matreshka", "nginx", "hysteria-server", "xray"].map((name) => ({ name, status: "active" }));
    this.db.setSetting("monitor_snapshot", {
      ...snapshot,
      services: services.map((item) => item.name === service ? { ...item, status: active ? "active" : "inactive" } : item),
    });
  }
}

function redactPayload(action: PrivilegedAction, payload: Record<string, unknown>) {
  if (action !== "backup.export") return payload;
  const { passphrase, ...safe } = payload;
  return passphrase === undefined ? safe : { ...safe, passphrase: "[REDACTED]" };
}

function operationEvent(action: PrivilegedAction, phase: "started" | "completed" | "failed") {
  if (action === "device.revoke") return null;
  const types: Record<Exclude<PrivilegedAction, "device.revoke">, Partial<Record<typeof phase, string>>> = {
    "backup.export": { started: "backup.started", completed: "backup.created", failed: "backup.failed" },
    "service.restart": { started: "service.restart_started", completed: "service.restarted", failed: "service.restart_failed" },
    "service.start": { started: "service.start_started", completed: "service.started", failed: "service.start_failed" },
    "service.stop": { started: "service.stop_started", completed: "service.stopped", failed: "service.stop_failed" },
    "nginx.reload": { started: "nginx.reload_started", completed: "nginx.reloaded", failed: "nginx.reload_failed" },
    "engine.update": { started: "engine.update_started", completed: "engine.updated", failed: "engine.update_failed" },
    "update.apply": { started: "app.update_started", completed: "app.updated", failed: "app.update_failed" },
  };
  return types[action][phase] ?? null;
}

function operationData(action: PrivilegedAction, payload: Record<string, unknown>) {
  if (action.startsWith("service.")) return { service: String(payload.service ?? "") };
  if (action === "engine.update") return { engine: String(payload.engine ?? ""), version: String(payload.version ?? "") };
  if (action === "update.apply") return { version: String(payload.version ?? "") || undefined };
  return {};
}

function operationResultData(action: PrivilegedAction, result: Record<string, unknown>, payload: Record<string, unknown>) {
  if (action !== "backup.export") return {};
  return {
    size: typeof result.size === "number" ? result.size : undefined,
    encrypted: typeof payload.passphrase === "string",
  };
}

function operationSubject(action: PrivilegedAction) {
  if (action.startsWith("service.")) return "service";
  if (action === "engine.update") return "engine";
  if (action === "device.revoke") return "device";
  return "operation";
}

function operationSubjectId(action: PrivilegedAction, payload: Record<string, unknown>) {
  if (action.startsWith("service.")) return String(payload.service ?? "") || null;
  if (action === "engine.update") return String(payload.engine ?? "") || null;
  if (action === "device.revoke") return String(payload.deviceId ?? "") || null;
  return null;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function serviceLabel(value: unknown) {
  const labels: Record<string, string> = { "hysteria-server": "Hysteria 2", xray: "Xray" };
  return labels[String(value ?? "")] ?? String(value ?? "");
}

function payloadHash(action: string, payload: unknown) {
  return createHash("sha256").update(`${action}\0${stableJson(payload)}`).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function callAgent(request: { action: string; payload: Record<string, unknown> }) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(config.agentSocket);
    let response = "";
    const timeout = request.action === "setup.finalize" ? 180_000 : request.action === "engine.update" ? 120_000 : 30_000;
    socket.setTimeout(timeout);
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.on("end", () => {
      try {
        const parsed = JSON.parse(response) as { ok: boolean; error?: string } & Record<string, unknown>;
        if (!parsed.ok) reject(new Error(parsed.error ?? "root-agent отклонил операцию"));
        else resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("timeout", () => socket.destroy(new Error(`root-agent не ответил за ${timeout / 1000} секунд`)));
    socket.on("error", reject);
  });
}
