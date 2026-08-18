import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AuthService } from "../src/server/auth/webauthn";
import { SetupService } from "../src/server/services/setup";
import { database } from "./helpers";

describe("initial domain setup", () => {
  let fixture: ReturnType<typeof database>;
  let auth: AuthService;
  let token: string;

  beforeEach(() => {
    fixture = database();
    auth = new AuthService(fixture.db);
    token = new URL(auth.ensureBootstrap()!).searchParams.get("bootstrap")!;
  });

  afterEach(() => fixture.close());

  test("returns only the installed address for a valid bootstrap token", () => {
    const setup = new SetupService(auth, { setup: true, publicIp: "203.0.113.42", adminPath: "/admin" });
    expect(setup.state(token)).toMatchObject({ publicIp: "203.0.113.42" });
    expect(() => setup.state("wrong-token-that-is-long-enough")).toThrow("Bootstrap-ссылка");
  });

  test("finalizes only a domain that resolves to the installed server", async () => {
    const requests: unknown[] = [];
    const setup = new SetupService(
      auth,
      { setup: true, publicIp: "203.0.113.42", adminPath: "/admin" },
      async () => ["203.0.113.42"],
      async (request) => { requests.push(request); return { ok: true }; },
    );
    const result = await setup.finalize({ bootstrapToken: token, domain: "Proxy.Example.com" });
    expect(requests).toEqual([{ action: "setup.finalize", payload: { domain: "proxy.example.com", publicIp: "203.0.113.42" } }]);
    expect(result.onboardingUrl).toBe(`https://proxy.example.com/admin/onboarding?bootstrap=${encodeURIComponent(token)}`);
  });

  test("does not invoke root-agent before DNS points to the server", async () => {
    let invoked = false;
    const setup = new SetupService(
      auth,
      { setup: true, publicIp: "203.0.113.42", adminPath: "/admin" },
      async () => ["198.51.100.10"],
      async () => { invoked = true; return { ok: true }; },
    );
    await expect(setup.finalize({ bootstrapToken: token, domain: "proxy.example.com" })).rejects.toThrow("не указывает");
    expect(invoked).toBeFalse();
  });

  test("returns an actionable setup error when root-agent fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const setup = new SetupService(
      auth,
      { setup: true, publicIp: "203.0.113.42", adminPath: "/admin" },
      async () => ["203.0.113.42"],
      async () => { throw new Error("socket closed"); },
    );
    const result = setup.finalize({ bootstrapToken: token, domain: "proxy.example.com" });
    await expect(result).rejects.toMatchObject({ status: 502 });
    await expect(result).rejects.toThrow("DNS-запись подтверждена");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  test("rejects setup after the server has switched to its final mode", () => {
    const setup = new SetupService(auth, { setup: false, publicIp: "203.0.113.42", adminPath: "/admin" });
    expect(() => setup.state(token)).toThrow("уже завершена");
  });

  test("does not accept an IP address or numeric suffix as a permanent domain", async () => {
    const setup = new SetupService(
      auth,
      { setup: true, publicIp: "203.0.113.42", adminPath: "/admin" },
      async () => ["203.0.113.42"],
      async () => ({ ok: true }),
    );
    await expect(setup.finalize({ bootstrapToken: token, domain: "203.0.113.42" })).rejects.toThrow("Укажите корректный домен");
    await expect(setup.finalize({ bootstrapToken: token, domain: "example.123" })).rejects.toThrow("Укажите корректный домен");
  });
});
