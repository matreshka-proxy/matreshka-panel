# Matreshka — панель

Self-hosted-панель для одного владельца, его близких и устройств. Matreshka разворачивает и поддерживает Hysteria 2 и VLESS + XHTTP на одном домене, выдаёт подписки для INCY и Everywhere/Mihomo, публикует общие правила маршрутизации и считает трафик по людям и устройствам без истории посещённых доменов.

> Статус: `0.1.0-rc.2`, pre-release. Локальные тесты и production-сборки проходят; первая полевая установка проходит VPS gate из [STATUS.md](STATUS.md).

## Архитектура

```text
UDP/443 → Hysteria 2
TCP/443 → Nginx → секретный XHTTP path → Xray на localhost
                 → admin/API/subscriptions → Matreshka на localhost
                 → остальные запросы → нейтральная страница
```

- интерфейс — Imba, собранный `bimba`;
- control plane — Bun + TypeScript + SQLite;
- привилегированные операции — минимальный Go-agent с allowlist;
- CLI/MCP — `matreshkactl`;
- Nginx, Hysteria 2 и Xray — отдельные systemd-службы;
- изменяемые настройки и ревизии живут в SQLite, независимо от release-каталогов.
- активация и отзыв устройств синхронизируются с Xray через персистентный SQLite-outbox;
- release archive подписывается Minisign, а installer/updater проверяют подпись до распаковки.

Подробности: [архитектура](docs/ARCHITECTURE.md), [разработка](docs/DEVELOPMENT.md), [развёртывание](docs/DEPLOYMENT.md), [безопасность](docs/SECURITY.md).

## Структура репозитория

- `src/web/` — Imba-интерфейс панели.
- `src/server/` — Bun/TypeScript API, SQLite, авторизация и сервисы.
- `src/cli/` — CLI и локальный MCP-сервер.
- `agent/` — минимальный привилегированный Go-agent.
- `infra/` — Nginx, systemd и скрипты установки/обновления.
- `assets/` и `public/` — исходные и собранные web-ресурсы.
- `tests/` — unit и integration тесты control plane.
- `docs/` — архитектура, разработка, deployment и security model.

## Локальная разработка

Нужны Bun 1.3.13 и Go 1.24+.

```bash
bun install --frozen-lockfile
bun run check
bun run dev
```

Панель с демонстрационными данными откроется на `http://localhost:8181/admin/`, а интерактивный pre-launch preview — на `http://localhost:8181/admin/setup?bootstrap=preview`.

## Установка на сервер

Нужна чистая Ubuntu 24.04 amd64 с публичным IPv4 и свободными портами TCP 80/443 и UDP 443. В web-консоли VPS выполните одну команду:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo bash /tmp/matreshka-install
```

Installer скачивает последний GitHub Release, проверяет detached Minisign signature, ставит только необходимые пакеты и получает короткоживущий доверенный сертификат Let's Encrypt для IP. Полное обновление Ubuntu и перезагрузка не выполняются. В конце команда печатает одноразовую HTTPS-ссылку.

Дальше в браузере можно выбрать бесплатный hostname или собственный домен. Matreshka показывает нужную A-запись, ждёт DNS, выпускает обычный сертификат домена и только после перехода на конечный адрес предлагает создать владельца и passkey.

Для установки конкретного RC вместо последнего стабильного release:

```bash
curl -fsSLo /tmp/matreshka-install https://raw.githubusercontent.com/matreshka-proxy/matreshka-panel/main/infra/scripts/bootstrap && sudo env MATRESHKA_VERSION=0.1.0-rc.2 bash /tmp/matreshka-install
```

Подробности, developer deploy и восстановление описаны в [документации по развёртыванию](docs/DEPLOYMENT.md).

## Лицензия

Matreshka распространяется по [GNU AGPL-3.0-only](LICENSE). Сведения о зависимостях — в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Именование

Публичное имя во всех языках интерфейса и документации пишется как `Matreshka`;
package name и GitHub-репозиторий используют `matreshka-panel`. Службы, CLI,
каталоги данных и environment variables используют `matreshka*` и
`MATRESHKA_*`; legacy-алиасов нет.
