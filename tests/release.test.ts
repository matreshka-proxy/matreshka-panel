import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

describe("release trust chain", () => {
  test("keeps the installer key identical to the committed Minisign public key", async () => {
    const publicKey = (await Bun.file(resolve(root, "infra/release/minisign.pub")).text()).trim().split("\n").at(-1)!;
    const installer = await Bun.file(resolve(root, "infra/scripts/install")).text();
    const bootstrap = await Bun.file(resolve(root, "infra/scripts/bootstrap")).text();
    expect(publicKey).toMatch(/^RW[QRT][A-Za-z0-9+/]{53}$/);
    expect(installer).toContain(`release_public_key="${publicKey}"`);
    expect(bootstrap).toContain(`release_public_key="${publicKey}"`);
  });

  test("obtains the trusted IP certificate before exposing the setup application", async () => {
    const installer = await Bun.file(resolve(root, "infra/scripts/install")).text();
    const certificate = installer.indexOf('--ip-address "$public_ip"');
    const services = installer.indexOf("systemctl enable --now nginx matreshka-agent matreshka");
    expect(certificate).toBeGreaterThan(0);
    expect(services).toBeGreaterThan(certificate);
    expect(installer).toContain("--preferred-profile shortlived");
  });

  test("keeps WebAuthn unreachable on the temporary IP edge", async () => {
    const nginx = await Bun.file(resolve(root, "infra/nginx/matreshka-setup.conf.template")).text();
    expect(nginx).toContain("location ^~ /api/v1/setup");
    expect(nginx).not.toContain("/api/v1/auth");
    expect(nginx).toContain("location / {\n        return 404;");
  });

  test("verifies detached signatures before update extraction", async () => {
    const updater = await Bun.file(resolve(root, "infra/scripts/apply-update")).text();
    const verify = updater.indexOf("minisign -Vm");
    const extract = updater.indexOf("tar -xzf");
    expect(verify).toBeGreaterThan(0);
    expect(extract).toBeGreaterThan(verify);
  });

  test("includes the release manifest in the signed checksum set", async () => {
    const script = await Bun.file(resolve(root, "scripts/release.ts")).text();
    const manifest = script.indexOf('writeFileSync(join(stage, "manifest.json")');
    const scan = script.indexOf('new Bun.Glob("**/*")');
    expect(manifest).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(manifest);
  });

  test("releases only a tag pointing at the current main commit", async () => {
    const workflow = await Bun.file(resolve(root, ".github/workflows/release.yml")).text();
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"');
  });
});
