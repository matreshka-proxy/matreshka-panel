import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { config } from "../config";
import type { MatreshkaDatabase } from "../db/database";
import { addHours, now } from "../db/database";
import { createToken, hashToken, tokensEqual } from "../security";
import { ServiceError } from "../services/people";
import { JournalService, parseUserAgent } from "../services/journal";

const registrationContext = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(80),
  bootstrapToken: z.string().optional(),
});

const registrationChallengeContext = registrationContext.omit({ bootstrapToken: true }).extend({
  ownerId: z.string().uuid(),
  bootstrapHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

const challengeLimitPerKind = 100;

type PasskeyRow = {
  id: string;
  owner_id: string;
  public_key: Uint8Array;
  counter: number;
  transports_json: string;
};

export class AuthService {
  private bootstrapToken?: string;
  private journal: JournalService;

  constructor(private db: MatreshkaDatabase, journal?: JournalService) {
    this.journal = journal ?? new JournalService(db);
  }

  ensureBootstrap() {
    if (this.owner()) return null;
    const existing = this.db.setting<{ hash: string; expiresAt: string } | null>("bootstrap", null);
    if (existing && existing.expiresAt > now()) return null;
    const token = createToken();
    this.bootstrapToken = token;
    this.db.setSetting("bootstrap", { hash: hashToken(token), expiresAt: addHours(1) });
    return this.bootstrapUrl(token);
  }

  resetBootstrap() {
    const owner = this.owner();
    if (owner) {
      this.db.raw.query("DELETE FROM sessions WHERE owner_id = ?").run(owner.id);
    }
    const token = createToken();
    this.bootstrapToken = token;
    this.db.setSetting("bootstrap", { hash: hashToken(token), expiresAt: addHours(1) });
    const auditId = this.db.audit({ actor: "root-cli", action: "auth.bootstrap.reset", resource: "owner", resourceId: owner?.id });
    this.journal.record("bootstrap.reset", { actor: "root-cli", auditId, subjectType: "owner", subjectId: owner?.id });
    return this.bootstrapUrl(token);
  }

  state() {
    const owner = this.owner();
    return {
      initialized: Boolean(owner),
      owner: owner ? { id: owner.id, name: owner.name, timezone: owner.timezone } : null,
      demo: config.demo,
    };
  }

  updateOwner(input: unknown, actor = "owner") {
    const owner = this.owner();
    if (!owner) throw new ServiceError(404, "Владелец ещё не создан");
    const data = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      timezone: z.string().trim().min(1).max(80).optional(),
    }).refine((value) => value.name !== undefined || value.timezone !== undefined, "Нет изменений").parse(input);
    const timestamp = now();
    const updated = { ...owner, name: data.name ?? owner.name, timezone: data.timezone ?? owner.timezone };
    this.db.raw.query("UPDATE owners SET name = ?, timezone = ?, updated_at = ? WHERE id = ?")
      .run(updated.name, updated.timezone, timestamp, owner.id);
    this.db.audit({ actor, action: "owner.update", resource: "owner", resourceId: owner.id, before: owner, after: updated });
    return updated;
  }

  async registrationOptions(input: unknown, authenticatedOwnerId?: string) {
    if (config.setup) throw new ServiceError(409, "Сначала подключите постоянный домен");
    const context = registrationContext.parse(input);
    const owner = this.owner();
    if (owner && authenticatedOwnerId !== owner.id) throw new ServiceError(401, "Нужна действующая сессия владельца");
    const bootstrap = owner ? null : this.verifyBootstrap(context.bootstrapToken);
    const ownerId = owner?.id ?? crypto.randomUUID();
    const passkeys = owner
      ? this.db.raw.query<{ id: string; transports_json: string }, string>("SELECT id, transports_json FROM passkeys WHERE owner_id = ?").all(owner.id)
      : [];
    const options = await generateRegistrationOptions({
      rpName: "Matreshka",
      rpID: config.rpID,
      userID: new TextEncoder().encode(ownerId),
      userName: context.name,
      userDisplayName: context.name,
      attestationType: "none",
      excludeCredentials: passkeys.map((key) => ({ id: key.id, transports: JSON.parse(key.transports_json) })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const challengeId = this.storeChallenge("registration", options.challenge, {
      name: context.name,
      timezone: context.timezone,
      ownerId,
      bootstrapHash: bootstrap?.hash,
    });
    return { challengeId, options };
  }

  async finishRegistration(challengeId: string, response: RegistrationResponseJSON, userAgent?: string) {
    const challenge = this.challenge(challengeId, "registration");
    const context = registrationChallengeContext.parse(challenge.context);
    if (!this.owner()) this.verifyBootstrapHash(context.bootstrapHash);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) throw new ServiceError(400, "Passkey не прошёл проверку");
    const info = verification.registrationInfo;
    const timestamp = now();
    this.db.raw.transaction(() => {
      if (!this.owner()) {
        this.db.raw.query("INSERT INTO owners (id, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(context.ownerId, context.name, context.timezone, timestamp, timestamp);
      }
      this.db.raw.query(`
        INSERT INTO passkeys (id, owner_id, public_key, counter, transports_json, device_type, backed_up, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        info.credential.id,
        context.ownerId,
        info.credential.publicKey,
        info.credential.counter,
        JSON.stringify(info.credential.transports ?? []),
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0,
        timestamp,
      );
      this.consumeChallenge(challengeId);
      this.db.setSetting("bootstrap", null);
    })();
    const auditId = this.db.audit({ actor: context.ownerId, action: "auth.passkey.register", resource: "passkey", resourceId: info.credential.id });
    this.journal.record("passkey.registered", {
      actor: context.ownerId,
      auditId,
      subjectType: "passkey",
      data: parseUserAgent(userAgent),
    });
    return this.createSession(context.ownerId, userAgent);
  }

  async authenticationOptions() {
    const owner = this.owner();
    if (!owner) throw new ServiceError(409, "Сначала завершите первоначальную настройку");
    const passkeys = this.db.raw.query<PasskeyRow, string>("SELECT * FROM passkeys WHERE owner_id = ?").all(owner.id);
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: passkeys.map((key) => ({
        id: key.id,
        transports: JSON.parse(key.transports_json) as AuthenticatorTransportFuture[],
      })),
      userVerification: "required",
    });
    const challengeId = this.storeChallenge("authentication", options.challenge, { ownerId: owner.id });
    return { challengeId, options };
  }

  async finishAuthentication(challengeId: string, response: AuthenticationResponseJSON, userAgent?: string) {
    const challenge = this.challenge(challengeId, "authentication");
    const passkey = this.db.raw.query<PasskeyRow, string>("SELECT * FROM passkeys WHERE id = ?").get(response.id);
    if (!passkey) throw new ServiceError(401, "Passkey не зарегистрирован");
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: JSON.parse(passkey.transports_json),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new ServiceError(401, "Не удалось подтвердить passkey");
    this.db.raw.transaction(() => {
      this.db.raw.query("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
        .run(verification.authenticationInfo.newCounter, now(), passkey.id);
      this.consumeChallenge(challengeId);
    })();
    const session = this.createSession(passkey.owner_id, userAgent);
    const auditId = this.db.audit({ actor: passkey.owner_id, action: "auth.login", resource: "session", resourceId: session.id });
    this.journal.record("auth.login_succeeded", {
      actor: passkey.owner_id,
      auditId,
      subjectType: "session",
      data: parseUserAgent(userAgent),
    });
    return session;
  }

  authenticate(sessionToken?: string, authorization?: string) {
    if (config.demo) return this.demoOwner();
    const token = sessionToken || (authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
    if (!token) return null;
    if (authorization?.startsWith("Bearer ")) {
      const api = this.db.raw.query<{ id: string; scopes_json: string; expires_at: string | null }, string>(`
        SELECT id, scopes_json, expires_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL
      `).get(hashToken(token));
      if (api && (!api.expires_at || api.expires_at > now())) {
        this.db.raw.query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now(), api.id);
        return { id: `token:${api.id}`, name: "API", timezone: "UTC", scopes: JSON.parse(api.scopes_json) as string[] };
      }
    }
    const row = this.db.raw.query<{ id: string; owner_id: string; expires_at: string }, string>(`
      SELECT id, owner_id, expires_at FROM sessions WHERE token_hash = ?
    `).get(hashToken(token));
    if (!row || row.expires_at <= now()) return null;
    this.db.raw.query("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
    return this.owner();
  }

  logout(token?: string) {
    if (token) this.db.raw.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  security(sessionToken?: string) {
    const owner = this.owner();
    if (!owner) throw new ServiceError(404, "Владелец ещё не создан");
    const currentHash = sessionToken ? hashToken(sessionToken) : null;
    const passkeys = this.db.raw.query<{
      id: string; device_type: string | null; backed_up: number; created_at: string; last_used_at: string | null;
    }, string>(`
      SELECT id, device_type, backed_up, created_at, last_used_at
      FROM passkeys WHERE owner_id = ? ORDER BY created_at DESC
    `).all(owner.id).map((row) => ({
      id: row.id,
      deviceType: row.device_type,
      backedUp: Boolean(row.backed_up),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
    const sessions = this.db.raw.query<{
      id: string; token_hash: string; expires_at: string; created_at: string; last_seen_at: string; user_agent: string | null;
    }, [string, string]>(`
      SELECT id, token_hash, expires_at, created_at, last_seen_at, user_agent
      FROM sessions WHERE owner_id = ? AND expires_at > ? ORDER BY last_seen_at DESC
    `).all(owner.id, now()).map((row) => ({
      id: row.id,
      current: row.token_hash === currentHash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      userAgent: row.user_agent,
    }));
    return { passkeys, sessions, tokens: this.apiTokens() };
  }

  revokePasskey(id: string, actor = "owner") {
    const owner = this.owner();
    if (!owner) throw new ServiceError(404, "Владелец ещё не создан");
    const count = this.db.raw.query<{ count: number }, string>("SELECT COUNT(*) AS count FROM passkeys WHERE owner_id = ?").get(owner.id)?.count ?? 0;
    if (count <= 1) throw new ServiceError(409, "Нельзя удалить единственный passkey владельца");
    const result = this.db.raw.query("DELETE FROM passkeys WHERE id = ? AND owner_id = ?").run(id, owner.id);
    if (!result.changes) throw new ServiceError(404, "Passkey не найден");
    const auditId = this.db.audit({ actor, action: "auth.passkey.revoke", resource: "passkey", resourceId: id });
    this.journal.record("passkey.revoked", { actor, auditId, subjectType: "passkey" });
  }

  endOtherSessions(sessionToken: string | undefined, actor = "owner") {
    const owner = this.owner();
    if (!owner) throw new ServiceError(404, "Владелец ещё не создан");
    if (!sessionToken) throw new ServiceError(400, "Текущая сессия не найдена");
    const result = this.db.raw.query("DELETE FROM sessions WHERE owner_id = ? AND token_hash != ?")
      .run(owner.id, hashToken(sessionToken));
    const auditId = this.db.audit({ actor, action: "auth.sessions.revoke_others", resource: "session", after: { revoked: result.changes } });
    this.journal.record("sessions.revoked_others", { actor, auditId, subjectType: "session", data: { revoked: result.changes } });
    return { revoked: result.changes };
  }

  revokeSession(id: string, sessionToken: string | undefined, actor = "owner") {
    const owner = this.owner();
    if (!owner) throw new ServiceError(404, "Владелец ещё не создан");
    if (!sessionToken) throw new ServiceError(400, "Текущая сессия не найдена");
    const currentHash = hashToken(sessionToken);
    const session = this.db.raw.query<{ token_hash: string }, [string, string]>(
      "SELECT token_hash FROM sessions WHERE id = ? AND owner_id = ?",
    ).get(id, owner.id);
    if (!session) throw new ServiceError(404, "Сессия не найдена");
    if (session.token_hash === currentHash) throw new ServiceError(409, "Текущую сессию нужно завершать выходом из панели");
    this.db.raw.query("DELETE FROM sessions WHERE id = ? AND owner_id = ?").run(id, owner.id);
    const auditId = this.db.audit({ actor, action: "auth.session.revoke", resource: "session", resourceId: id });
    this.journal.record("session.revoked", { actor, auditId, subjectType: "session" });
  }

  createApiToken(name: string, scopes: string[], actor = "owner") {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 80) throw new ServiceError(400, "Укажите имя токена до 80 символов");
    const allowed = new Set([
      "status:read", "traffic:read", "people:read", "people:write", "routes:read", "routes:write",
      "operations:read", "operations:write", "settings:read", "settings:write", "engines:read", "engines:write",
      "system:read", "backups:read",
    ]);
    const uniqueScopes = Array.from(new Set(scopes));
    if (!uniqueScopes.length || uniqueScopes.some((scope) => !allowed.has(scope))) throw new ServiceError(400, "Запрошен недопустимый scope");
    const token = createToken();
    const id = crypto.randomUUID();
    this.db.raw.query(`
      INSERT INTO api_tokens (id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(id, cleanName, hashToken(token), JSON.stringify(uniqueScopes), now());
    const auditId = this.db.audit({ actor, action: "tokens.create", resource: "api_token", resourceId: id, after: { name: cleanName, scopes: uniqueScopes } });
    this.journal.record("token.created", { actor, auditId, subjectType: "api_token", subjectId: id, data: { name: cleanName, scopes: uniqueScopes } });
    return { id, name: cleanName, scopes: uniqueScopes, token };
  }

  apiTokens() {
    return this.db.raw.query<{
      id: string; name: string; scopes_json: string; expires_at: string | null; created_at: string; last_used_at: string | null;
    }, []>(`
      SELECT id, name, scopes_json, expires_at, created_at, last_used_at
      FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC
    `).all().map((row) => ({ ...row, scopes: JSON.parse(row.scopes_json), scopes_json: undefined }));
  }

  revokeApiToken(id: string, actor = "owner") {
    const token = this.db.raw.query<{ name: string }, string>("SELECT name FROM api_tokens WHERE id = ? AND revoked_at IS NULL").get(id);
    const result = this.db.raw.query("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id);
    if (!result.changes) throw new ServiceError(404, "API-токен не найден");
    const auditId = this.db.audit({ actor, action: "tokens.revoke", resource: "api_token", resourceId: id });
    this.journal.record("token.revoked", { actor, auditId, subjectType: "api_token", subjectId: id, data: { name: token?.name ?? "API" } });
  }

  verifyBootstrapToken(token?: string) {
    return this.verifyBootstrap(token);
  }

  private createSession(ownerId: string, userAgent?: string) {
    const token = createToken();
    const session = { id: crypto.randomUUID(), token, expiresAt: addHours(config.sessionHours) };
    this.db.raw.query(`
      INSERT INTO sessions (id, owner_id, token_hash, expires_at, created_at, last_seen_at, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, ownerId, hashToken(token), session.expiresAt, now(), now(), userAgent ?? null);
    return session;
  }

  private owner() {
    return this.db.raw.query<{ id: string; name: string; timezone: string }, []>("SELECT id, name, timezone FROM owners LIMIT 1").get() ?? null;
  }

  private demoOwner() {
    let owner = this.owner();
    if (owner) return owner;
    const timestamp = now();
    owner = { id: crypto.randomUUID(), name: "Федор", timezone: "Europe/Moscow" };
    this.db.raw.query("INSERT INTO owners (id, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(owner.id, owner.name, owner.timezone, timestamp, timestamp);
    return owner;
  }

  private verifyBootstrap(token?: string) {
    const bootstrap = this.db.setting<{ hash: string; expiresAt: string } | null>("bootstrap", null);
    if (!token || !bootstrap || bootstrap.expiresAt <= now() || !tokensEqual(token, bootstrap.hash)) {
      throw new ServiceError(401, "Bootstrap-ссылка недействительна или истекла");
    }
    return bootstrap;
  }

  private bootstrapUrl(token: string) {
    const page = config.setup ? "setup" : "onboarding";
    return `${config.origin}${config.adminPath}/${page}?bootstrap=${token}`;
  }

  private verifyBootstrapHash(hash?: string) {
    const bootstrap = this.db.setting<{ hash: string; expiresAt: string } | null>("bootstrap", null);
    if (!hash || !bootstrap || bootstrap.expiresAt <= now() || bootstrap.hash !== hash) {
      throw new ServiceError(401, "Bootstrap-ссылка недействительна или истекла");
    }
  }

  private storeChallenge(kind: string, challenge: string, context: unknown) {
    this.pruneChallenges();
    const count = this.db.raw.query<{ count: number }, string>(
      "SELECT COUNT(*) AS count FROM webauthn_challenges WHERE kind = ?",
    ).get(kind)?.count ?? 0;
    if (count >= challengeLimitPerKind) {
      throw new ServiceError(429, "Слишком много незавершённых WebAuthn-запросов — попробуйте позже");
    }
    const id = crypto.randomUUID();
    this.db.raw.query(`
      INSERT INTO webauthn_challenges (id, kind, challenge, context_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, kind, challenge, JSON.stringify(context), addHours(0.17), now());
    return id;
  }

  private challenge(id: string, kind: string) {
    this.pruneChallenges();
    const row = this.db.raw.query<{ kind: string; challenge: string; context_json: string; expires_at: string }, string>(
      "SELECT kind, challenge, context_json, expires_at FROM webauthn_challenges WHERE id = ?",
    ).get(id);
    if (!row || row.kind !== kind || row.expires_at <= now()) throw new ServiceError(400, "WebAuthn challenge недействителен или истёк");
    return { challenge: row.challenge, context: JSON.parse(row.context_json) as unknown };
  }

  private consumeChallenge(id: string) {
    this.db.raw.query("DELETE FROM webauthn_challenges WHERE id = ?").run(id);
  }

  private pruneChallenges() {
    this.db.raw.query("DELETE FROM webauthn_challenges WHERE expires_at <= ?").run(now());
  }
}
