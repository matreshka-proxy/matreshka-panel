import { resolve4 } from "node:dns/promises";
import { z } from "zod";
import { config } from "../config";
import type { AuthService } from "../auth/webauthn";
import { ServiceError } from "./people";
import { callAgent } from "./operations";

const domainSchema = z.string().trim().toLowerCase().max(253).refine(validDomain, "Укажите корректный домен");

type SetupConfig = Pick<typeof config, "setup" | "publicIp" | "adminPath">;
type Resolver = (domain: string) => Promise<string[]>;
type Runner = typeof callAgent;

export class SetupService {
  constructor(
    private auth: AuthService,
    private settings: SetupConfig = config,
    private resolver: Resolver = resolve4,
    private runner: Runner = callAgent,
  ) {}

  state(token?: string) {
    this.requireSetup();
    const bootstrap = this.auth.verifyBootstrapToken(token);
    return {
      publicIp: this.settings.publicIp,
      expiresAt: bootstrap.expiresAt,
    };
  }

  async finalize(input: unknown) {
    this.requireSetup();
    const body = z.object({
      bootstrapToken: z.string().min(20).max(200),
      domain: domainSchema,
    }).parse(input);
    this.auth.verifyBootstrapToken(body.bootstrapToken);

    let addresses: string[];
    try {
      addresses = await this.resolver(body.domain);
    } catch {
      throw new ServiceError(409, "DNS-запись пока не найдена — проверьте адрес и попробуйте ещё раз");
    }
    if (!addresses.includes(this.settings.publicIp)) {
      throw new ServiceError(409, `Домен пока не указывает на этот сервер (${this.settings.publicIp})`);
    }

    try {
      await this.runner({
        action: "setup.finalize",
        payload: { domain: body.domain, publicIp: this.settings.publicIp },
      });
    } catch (error) {
      console.error(`[SETUP] Не удалось применить домен ${body.domain}:`, error);
      throw new ServiceError(502, "DNS-запись подтверждена, но сервер не смог завершить настройку домена — попробуйте ещё раз");
    }
    return {
      domain: body.domain,
      origin: `https://${body.domain}`,
      onboardingUrl: `https://${body.domain}${this.settings.adminPath}/onboarding?bootstrap=${encodeURIComponent(body.bootstrapToken)}`,
    };
  }

  private requireSetup() {
    if (!this.settings.setup || !validIPv4(this.settings.publicIp)) {
      throw new ServiceError(409, "Первоначальная настройка домена уже завершена");
    }
  }
}

function validDomain(value: string) {
  if (!value.includes(".") || value.endsWith(".") || validIPv4(value)) return false;
  const labels = value.split(".");
  return /[a-z]/.test(labels.at(-1)!) && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function validIPv4(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
