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

  test("serves ACME challenges from an nginx-readable webroot before certificate issuance", async () => {
    const installer = await Bun.file(resolve(root, "infra/scripts/install")).text();
    const nginxFiles = [
      "matreshka-setup-http.conf.template",
      "matreshka-setup.conf.template",
      "matreshka.conf.template",
    ];
    expect(installer).toContain("acme_webroot=/var/www/matreshka-acme");
    expect(installer).not.toContain("/var/lib/matreshka/acme");
    expect(installer.indexOf("matreshka-acme-ok")).toBeLessThan(installer.indexOf('"$certbot" certonly'));
    for (const file of nginxFiles) {
      const nginx = await Bun.file(resolve(root, "infra/nginx", file)).text();
      expect(nginx).toContain("root /var/www/matreshka-acme;");
      expect(nginx).not.toContain("/var/lib/matreshka/acme");
    }
  });

  test("rolls back a failed first installation so the public command can be retried", async () => {
    const installer = await Bun.file(resolve(root, "infra/scripts/install")).text();
    expect(installer).toContain("rollback_install()");
    expect(installer).toContain("systemctl stop nginx");
    expect(installer).toContain("rm -rf /opt/matreshka /etc/matreshka /var/lib/matreshka");
    expect(installer).toContain("rollback_armed=0");
  });

  test("keeps WebAuthn unreachable on the temporary IP edge", async () => {
    const nginx = await Bun.file(resolve(root, "infra/nginx/matreshka-setup.conf.template")).text();
    expect(nginx).toContain("location ^~ /api/v1/setup");
    expect(nginx).not.toContain("/api/v1/auth");
    expect(nginx).toContain("location / {\n        return 404;");
  });

  test("proxies every edge response to Bun over HTTP/1.1", async () => {
    for (const file of ["matreshka-setup.conf.template", "matreshka.conf.template"]) {
      const nginx = await Bun.file(resolve(root, "infra/nginx", file)).text();
      const tlsServer = nginx.indexOf("server {\n    listen 443");
      const securityHeaders = nginx.indexOf("\n    add_header", tlsServer);
      expect(tlsServer).toBeGreaterThan(0);
      expect(securityHeaders).toBeGreaterThan(tlsServer);
      expect(nginx.slice(tlsServer, securityHeaders)).toContain("proxy_http_version 1.1;");
    }
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
