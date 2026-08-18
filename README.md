# Matreshka

Matreshka is a self-hosted proxy management panel for one owner, trusted people,
and their devices. It deploys and maintains two proxy stacks on a single domain,
provides client subscriptions for INCY and Everywhere/Mihomo, publishes shared
routing rules, and tracks traffic by person and device without storing browsing
history.

> **Status:** `0.1.0-rc.5` pre-release. Local tests and production builds pass;
> the first real-world installation is progressing through the VPS gate described
> in [STATUS.md](STATUS.md).

## Supported protocols

Matreshka currently supports two proxy stacks:

- **VLESS over XHTTP and TLS**, powered by Xray-core, on `TCP/443`.
- **Hysteria 2** on `UDP/443`.

No other protocols are supported yet.

## Architecture

```text
UDP/443 → Hysteria 2
TCP/443 → Nginx → secret XHTTP path → Xray on localhost
                 → admin/API/subscriptions → Matreshka on localhost
                 → all other requests → neutral fallback page
```

- The web interface is written in Imba and built with `bimba`.
- The control plane uses Bun, TypeScript, and SQLite.
- Privileged operations are handled by a minimal allowlisted Go agent.
- `matreshkactl` provides a CLI and a local MCP server.
- Nginx, Hysteria 2, and Xray run as separate systemd services.
- Mutable settings and revisions live in SQLite, independently of release
  directories.
- Device activation and revocation are synchronized with Xray through a
  persistent SQLite outbox.
- Release archives are signed with Minisign, and signatures are verified before
  installation or updates.

For more details, see the documentation for
[architecture](docs/ARCHITECTURE.md),
[development](docs/DEVELOPMENT.md),
[deployment](docs/DEPLOYMENT.md), and
[security](docs/SECURITY.md).

## Installation and running

### Install on a server

You need a clean Ubuntu 24.04 amd64 server with a public IPv4 address and
available ports `TCP/80`, `TCP/443`, and `UDP/443`.

Run the following command in your VPS web console:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo bash /tmp/matreshka-install
```

The installer downloads the latest GitHub Release, verifies its detached
Minisign signature, installs only the required packages, starts Matreshka, and
obtains a short-lived trusted Let's Encrypt certificate for the server's IP
address. It does not perform a full Ubuntu upgrade or reboot the server.

When the installation finishes, it prints a one-time HTTPS setup URL. Open the
URL in a browser, choose a free hostname or your own domain, and follow the setup
flow. Matreshka shows the required DNS `A` record, waits for DNS propagation,
issues the final domain certificate, and then lets you create the owner account
and passkey.

To install a specific release candidate instead of the latest stable release:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo env MATRESHKA_VERSION=0.1.0-rc.5 bash /tmp/matreshka-install
```

See the [deployment guide](docs/DEPLOYMENT.md) for developer deployment,
updates, and recovery procedures.

### Run locally

Local development requires Bun `1.3.13` and Go `1.24` or newer.

```bash
git clone https://github.com/matreshka-proxy/matreshka-panel.git
cd matreshka-panel
bun install --frozen-lockfile
bun run check
bun run dev
```

The panel starts with demo data at <http://localhost:8181/admin/>. The interactive
pre-launch preview is available at
<http://localhost:8181/admin/setup?bootstrap=preview>.

## Repository structure

- `src/web/` — Imba web interface.
- `src/server/` — Bun/TypeScript API, SQLite storage, authentication, and
  services.
- `src/cli/` — CLI and local MCP server.
- `agent/` — minimal privileged Go agent.
- `infra/` — Nginx and systemd configuration, installation, and update scripts.
- `assets/` and `public/` — source and compiled web assets.
- `tests/` — control-plane unit and integration tests.
- `docs/` — architecture, development, deployment, and security documentation.

## License

Matreshka is licensed under the [GNU AGPL-3.0-only](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party dependency
notices.

## Naming

The public project name is always written as `Matreshka`. The package and GitHub
repository use `matreshka-panel`. Services, CLI tools, data directories, and
environment variables use the `matreshka*` and `MATRESHKA_*` prefixes. There are
no legacy aliases.
