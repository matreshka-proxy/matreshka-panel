# Развёртывание и эксплуатация

## Требования

- чистая Ubuntu 24.04 amd64;
- один публичный IPv4;
- снаружи доступны TCP 80/443 и UDP 443;
- доступ к web-консоли VPS или SSH для одной стартовой команды;
- бесплатный hostname в поддерживаемом DNS-сервисе либо собственный домен, DNS которого можно изменить.

## Первая установка

1. Владелец вставляет одну команду в web-консоль хостера. Локальный `matreshkactl` не требуется.
2. Installer проверяет Ubuntu и порты, верифицирует подписанный release, ставит control plane и получает короткоживущий Let's Encrypt certificate для public IP.
3. В консоль выводится одноразовая `https://<ip>/admin/setup?...` ссылка, действующая 1 час.
4. Pre-launch UI предлагает получить бесплатный hostname через DuckDNS, FreeMyIP или dynv6 либо подключить собственный домен. Затем показывает точную A-запись и опрашивает DNS.
5. После подтверждения DNS сервер получает обычный certificate для домена, атомарно применяет Nginx/Hysteria/Xray configs и перенаправляет браузер на `https://<domain>/admin/onboarding?...`.
6. Владелец и passkey создаются только на конечном HTTPS origin/RP ID. После этого IP-bootstrap отключается.

Временный IP certificate не используется как WebAuthn RP ID и не попадает в клиентские профили. Он защищает только pre-launch сессию. Внешний DNS-сервис выдаёт только hostname: certificate выпускает сама Matreshka, а credentials или tokens этого сервиса панель в v1 не хранит.

Запустите в web-консоли VPS:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo bash /tmp/matreshka-install
```

Для field test конкретного pre-release:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo env MATRESHKA_VERSION=0.1.0-rc.4 bash /tmp/matreshka-install
```

Bootstrap устанавливает `curl`, CA certificates и Minisign, определяет release, скачивает archive и signature с GitHub и проверяет встроенным public key до запуска release installer. Release installer повторно проверяет подпись, затем ставит Nginx, UFW, SQLite/age, pinned tunnel engines и актуальный Certbot из официального snap. Ubuntu 24.04 содержит Certbot 2.9, а IP certificates требуют Certbot 5.4+; поэтому apt-версия Certbot не используется.

`apt-get update` обновляет только индекс пакетов, а `apt-get install` добавляет зависимости Matreshka. Installer не выполняет `full-upgrade`, не меняет kernel и не перезагружает VPS.

Если одноразовая ссылка истекла, получите новую server-local командой:

```bash
sudo matreshkactl bootstrap-reset
```

## Developer deploy

Для отладки release pipeline разработчик может собрать подписанный archive локально и передать его на чистый VPS по SSH:

```bash
bun install --frozen-lockfile
bun run build:cli:mac
./dist/matreshkactl-darwin-arm64 deploy root@203.0.113.10
```

Developer deploy требует локальные Bun, Go, SSH, SCP и release signing key. Он запускает тот же IP-first installer и не является пользовательским installation surface.

Developer deploy также требует локальный Minisign key вне репозитория. Канонический public key находится в `infra/release/minisign.pub`; private key хранится отдельно и загружен как environment secret `release/MINISIGN_SECRET_KEY` в GitHub.

## Каталоги

```text
/opt/matreshka/releases/<version>  immutable application bundles
/opt/matreshka/current             active symlink
/opt/matreshka/engines             versioned Hysteria/Xray
/etc/matreshka                     environment and rendered configs
/var/lib/matreshka                 SQLite, master key, runtime and backups
```

## Обновление

```bash
MATRESHKA_VERSION=0.1.1 \
MATRESHKA_AGENT_BINARY=dist/matreshka-agent \
MATRESHKA_MINISIGN_SECRET_KEY="$HOME/.config/matreshka/release.key" \
MATRESHKA_REQUIRE_SIGNATURE=1 bun run release:linux
./dist/matreshkactl-darwin-arm64 update root@SERVER \
  --bundle release/matreshka-0.1.1-linux-amd64.tar.gz \
  --signature release/matreshka-0.1.1-linux-amd64.tar.gz.minisig
```

Updater сначала проверяет detached Minisign signature ключом из уже доверенной установленной версии и только затем распаковывает archive и сверяет внутренний `SHA256SUMS`, включая `manifest.json`. Он оставляет минимум две предыдущие версии. После неуспешного readiness автоматически восстанавливаются code symlink и предмиграционный SQLite snapshot.

GitHub workflow `Signed release` запускается только вручную из ветки `main` для уже существующего `v*` tag и делает checkout по точному `refs/tags/<tag>`. Tag обязан точно совпадать с версией в `package.json`. Build/test выполняются без ключа; отдельный job в environment `release`, ограниченном веткой `main`, получает private key, подписывает archive, повторно проверяет подпись и публикует immutable GitHub Release. Версии с дефисом, например `v0.1.0-rc.4`, помечаются как pre-release и не выбираются bootstrap-командой без явного `MATRESHKA_VERSION`.

## Backup и restore

На сервере интерактивно:

```bash
sudo /opt/matreshka/current/bin/matreshkactl backup export /var/lib/matreshka/backups/manual.age
```

UI создаёт тот же стандартный age passphrase archive, но шифрование выполняет root-agent без передачи passphrase в argv, SQLite или audit log.

Restore выполняется после установки, пока владелец ещё не создан:

```bash
sudo /opt/matreshka/current/bin/matreshkactl restore /path/to/backup.age
```

Архив содержит SQLite, master key, `/etc/matreshka` и Nginx site config. Engine binaries и TLS certificates не включаются. Для переноса тот же домен нужно направить на новый IP и получить новый сертификат до restore.

## MCP

Создайте scoped API token в REST API и на локальном компьютере задайте:

```bash
export MATRESHKA_URL=https://proxy.example.com
export MATRESHKA_TOKEN=...
./dist/matreshkactl-darwin-arm64 mcp
```

Публичный MCP-порт не используется. Деструктивные действия требуют `operation_preview`, затем `operation_confirm` с неизменившимися action и payload.
