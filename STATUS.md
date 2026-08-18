# Состояние Matreshka v1

Обновлено: 18 августа 2026.

## Реализовано

- monorepo Bun/TypeScript + Imba/bimba + Go-agent + CLI/MCP;
- responsive UI: Главная, Люди, Маршруты, Трафик, Система с обслуживанием, login, pre-launch с бесплатным hostname или своим доменом, onboarding и invite;
- WebAuthn passkeys, сессии, bootstrap reset и scoped API-токены;
- люди, устройства, отдельные credentials, одноразовые приглашения, 24-часовой повторный импорт и отзыв;
- INCY и Mihomo подписки с Hysteria 2 + VLESS XHTTP, DNS и маршрутизацией;
- draft/publish/diff/rollback маршрутов и защищённые defaults;
- статистика Hysteria/Xray с delta после restart и rollup 5m → 1h → 1d;
- реальный типизированный журнал с audit links, server-side фильтрами, поиском, cursor pagination и структурированным diff;
- presence устройств: Hysteria `/online`, Xray activity delta, состояния online/offline/unknown и агрегирование по человеку;
- события первого появления, отсутствия более 24 часов и возвращения без спама от регулярных refresh;
- фоновый мониторинг systemd, telemetry, диска и TLS с baseline, двумя ошибками до инцидента и одним recovery;
- privacy-redaction журнала: credentials, tokens, passphrase, IP и destination history не сохраняются;
- raw templates движков с protected blocks, preview/diff, ревизиями, validator и rollback;
- Nginx one-domain split, отключённые secret URL logs, systemd hardening и UFW;
- pinned Hysteria/Xray с SHA-256;
- immutable releases, migration snapshot и автоматический rollback обновления;
- переносимый age-backup из CLI и UI, restore на установке без владельца;
- локальный stdio MCP с двухэтапным подтверждением опасных операций;
- единое внутреннее именование `matreshka` для служб, бинарников, CLI,
  каталогов данных, environment variables, cookie и UI-префиксов без
  legacy-алиасов;
- CI для Bun/Imba/TypeScript, Linux build, macOS CLI и Go-agent.
- публичный server-side bootstrap: одна команда на чистой Ubuntu 24.04, signed GitHub Release, Certbot 5.4+ из snap и trusted short-lived IP certificate;
- pre-launch API проверяет bootstrap token и DNS, root-agent повторно валидирует domain/IPv4 и атомарно переключает Nginx/Hysteria/Xray на final domain certificate;
- временный IP Nginx разрешает только setup UI/API и не публикует WebAuthn или owner dashboard;
- UI entrypoint механически разнесён по feature-модулям; `app.imba` содержит только composition root;
- owner dashboard отделён от минимального `/api/v1/status`, поэтому `status:read` не раскрывает людей, маршруты, settings, configs и tokens;
- WebAuthn challenge не хранит raw bootstrap token, просроченные записи чистятся, незавершённые записи ограничены;
- персистентный device-sync outbox завершает activation/revoke в БД только после Xray и повторяет interrupted/failed jobs;
- Nginx hardening: default Host/SNI servers, fixed-domain redirect, rate/body limits, HSTS и fixed upstream Host;
- actions pinned по commit SHA, release workflow запускается вручную из `main`, checkout делает только точный `refs/tags/<tag>`, затем workflow подписывает Minisign и публикует GitHub Release через environment secret;
- release manifest входит в `SHA256SUMS`, installer/updater проверяют detached signature до распаковки;
- dependency override перевёл Imba toolchain на `esbuild 0.25.0`, `bun audit` чист.

## Проверено локально и на VPS

- TypeScript typecheck и Imba production build;
- 76 unit/integration tests, включая setup/DNS/root-agent contract, ACME webroot/rollback, ACL status/dashboard, WebAuthn storage, persistent device outbox, release trust chain, journal API, redaction, Hysteria/Xray presence и monitoring;
- Go policy tests и статический linux/amd64 agent build;
- standalone Linux server/CLI и macOS CLI builds;
- desktop/mobile browser QA основных страниц и модальных сценариев;
- shellcheck bootstrap/install/finalize scripts и actionlint обоих workflows;
- Nginx template проходит `nginx -t` на Nginx 1.31 (совместимый `listen ... http2` оставлен для Ubuntu 24.04);
- подписанный локальный `matreshka-0.1.0-rc.1-linux-amd64.tar.gz`: Minisign verify, все внутренние SHA-256 и отрицательный tamper test проходят;
- Minisign private key находится вне репозитория с mode `0600` и загружен в GitHub environment `release`; public key закоммичен.
- Gitleaks 8.30.1 просканировал исходное дерево: реальных секретов не найдено; pinned public Xray SHA-256 документирован в точечном allowlist.
- GitHub-репозиторий публичен, `main` защищена обязательными CI-проверками и squash PR; включены secret scanning, push protection и Dependabot security updates;
- signed workflow успешно опубликовал pre-release [`v0.1.0-rc.2`](https://github.com/matreshka-proxy/matreshka-panel/releases/tag/v0.1.0-rc.2); archive SHA-256 `a6c84eb9fba0d1653f26ca03d08179760751b0d91c023d6766346c836f3ed8e0`;
- публичная one-line установка `v0.1.0-rc.2` прошла на Ubuntu 24.04 amd64: detached Minisign signature и внутренний `SHA256SUMS` подтверждены на сервере;
- Let's Encrypt выдал trusted short-lived certificate с IP SAN `57.131.140.147`; внешние `/healthz`, `/readyz` и setup page доступны по HTTPS без отключения TLS verification;
- Nginx, Matreshka и root-agent active/enabled, UFW active; Xray и Hysteria остаются disabled до browser-перехода на конечный домен;
- Gitleaks повторно проверил текущее дерево и всю Git-историю перед публикацией: секретов и legacy-названия нет; `bun audit` не нашёл уязвимостей.

## Оставшийся полевой gate

Первая установка и временный IP edge проверены. До production-ready остаются:

1. browser DNS polling и атомарный переход с IP edge на domain certificate;
2. реальные INCY/Everywhere imports на iPhone и Mac;
3. Hysteria UDP/443 и Xray XHTTP TCP/443 через внешнюю сеть;
4. корректность HandlerService команд на pinned Xray 26.3.27;
5. traffic counters обоих движков в течение минимум суток;
6. Hysteria connect/disconnect, Xray activity window, сон/пробуждение телефона и offline/returned после 24 часов;
7. остановка/восстановление движка и проверка единственного incident/recovery в журнале;
8. намеренно сломанный update и автоматический rollback;
9. age export/restore на второй чистой VM с тем же доменом;
10. WebAuthn e2e с virtual authenticator на final domain;

До прохождения gate проект следует считать pre-release, а не production-ready.
