# Архитектура

## Процессы и границы привилегий

Matreshka работает от отдельного непривилегированного пользователя и слушает только `127.0.0.1:8181`. Nginx — единственный публичный TCP edge. Hysteria самостоятельно занимает UDP/443. Xray слушает localhost:10000, а его API — localhost:10085.

Root-agent доступен только через `/run/matreshka/agent.sock`, принимает JSON-запросы размером до 64 KiB и выполняет фиксированный набор действий: restart разрешённых служб, Nginx reload, однократный finalize домена, update, backup, применение конфигураций и динамическое изменение пользователей Xray. Произвольных команд и путей в контракте нет. Domain finalize запускается как отдельный фиксированный transient systemd unit, повторно проверяет DNS и переключает только заранее определённые файлы.

## Первый запуск

Основной installation surface — сам VPS, а не локальный компьютер. После одной команды в web-консоли хостера installer поднимает минимальный pre-launch control plane по публичному IP с короткоживущим доверенным TLS certificate. Доступ ограничен высокоэнтропийной одноразовой ссылкой с TTL 1 час.

Pre-launch имеет одну задачу: принять постоянный hostname — бесплатный или на собственном домене, показать A-запись, дождаться DNS, получить domain certificate и атомарно применить final configs. Интерфейс рекомендует DuckDNS, FreeMyIP и dynv6, но не хранит их accounts или tokens: пользователь возвращает только полученный hostname. До этого движки, подписки и WebAuthn не активируются. Владелец и passkey всегда создаются на final HTTPS origin, потому что RP ID не должен меняться при переходе с IP на постоянный адрес.

После первого успешного WebAuthn registration bootstrap token отзывается, IP setup routes отключаются, а Nginx отвечает на посторонние Host нейтральной страницей. `matreshkactl` остаётся server-local и automation interface для doctor, backup/restore, emergency recovery и stdio MCP, но не является обязательным GUI installer.

## Данные

SQLite в `/var/lib/matreshka/matreshka.sqlite` — источник истины для владельца, passkeys, сессий, людей, устройств, маршрутов, конфигурационных ревизий, трафика, операций, событий и настроек UI.

Credentials движков шифруются AES-256-GCM мастер-ключом `/var/lib/matreshka/master.key`. Subscription token устройства детерминированно выводится через HMAC-SHA-256 из мастер-ключа и device ID; в таблице устройства хранится только SHA-256 hash. Поэтому backup мастер-ключа сохраняет существующие URL, но база не содержит raw subscription tokens.

`device_sync_jobs` — персистентный outbox между SQLite и Xray. Invitation сначала резервируется как `redeeming`, но устройство остаётся `invited` до успешного применения recovery config. При отзыве active status и subscription token сохраняются до подтверждения Xray. Сбой оставляет retryable job; старт control plane возвращает прерванные `running` jobs в очередь. Повторное применение идемпотентно: recovery config заранее включает активируемое или исключает отзываемое устройство.

### Audit и пользовательский журнал

`audit_log` — полная техническая история доменных изменений с `before/after`. Таблица `events` — отдельный типизированный пользовательский журнал: каноническими являются `type`, категория, kind, severity, outcome и безопасный `data_json`, а русский title/description формирует `JournalService`. Значимые изменения связываются с audit через `audit_id`; общий transaction-helper записывает мутацию, audit и journal event атомарно.

`GET /api/v1/system/events` выполняет фильтрацию, поиск и cursor pagination на сервере. Dashboard получает последние восемь строк через тот же `JournalService`. Draft-редактирование маршрутов, preview подтверждений и другие технические промежуточные действия остаются только в audit и не перегружают пользовательскую ленту.

Перед записью journal payload рекурсивно очищается от token/password/passphrase/credentials/challenge, сетевых адресов, destination/domain и секретных URL/path. В журнал и presence не импортируются raw journald, access logs, Hysteria stream dump или Xray IP list. Автоматического удаления journal/audit в v1 нет; retention остаётся отдельной задачей.

### Presence и телеметрия

Один 30-секундный цикл собирает трафик и presence без повторных запросов. Hysteria параллельно запрашивает официальные `/traffic` и `/online`: число соединений является точным online-сигналом, два успешных отсутствия переводят устройство в offline, а ошибка API — в unknown. Xray остаётся на стабильной версии `26.3.27`: положительный delta пользовательских uplink/downlink счётчиков даёт online на две минуты; reset счётчика сам по себе активностью не считается.

`device_presence` хранит независимое состояние Hysteria/Xray, а публичный `device.presence` агрегирует его по правилу online > unknown > offline. `devices.first_seen_at` и `last_seen_at` обновляются только реальной активностью, а не временем опроса. В журнал попадают только первое появление, отсутствие более 24 часов и возвращение; обычные переходы presence строк не создают.

Отдельный 60-секундный monitoring-service проверяет systemd, диск и TLS. `monitor_states` хранит baseline и дедуплицирует инциденты: событие создаётся после двух ошибок, recovery — после одного успеха. Для диска действуют пороги 85%/95% и recovery ниже 80%, для TLS — 30/7 дней. Первый опрос после старта только устанавливает baseline.

## Подписки и маршруты

Каждое устройство связано с одним client adapter:

- INCY получает plain subscription с Hysteria/VLESS, документированные subscription headers и version-stable autorouting JSON;
- Everywhere получает полный Mihomo YAML с двумя proxy nodes, fallback-группой, DNS и правилами.

Маршруты редактируются как draft. Publish создаёт immutable revision. Subscription URL не меняется: INCY самостоятельно обновляет routing source, Everywhere обновляет весь профиль.

## Конфигурации движков

Raw editor хранит пользовательский template отдельно от rendered config. Protected placeholders отвечают за auth/users, Stats API, localhost listen, TLS и секретные paths. Применение проходит через preview → syntactic/protected validation → root-agent → native Xray validation → atomic replace → restart/health. При ошибке восстанавливается предыдущий файл. Для Hysteria, у которой нет validate-only команды, окончательной проверкой служит успешный systemd restart.

## Обновления

Код устанавливается в `/opt/matreshka/releases/<version>`, активная версия выбирается symlink `/opt/matreshka/current`. Данные и конфиги находятся за пределами release. Detached Minisign signature проверяется ключом из доверенной текущей версии до чтения manifest и распаковки; затем `SHA256SUMS` проверяет каждый файл release, включая manifest. Updater останавливает только control plane, делает SQLite checkpoint и snapshot, мигрирует новой CLI, переключает symlink и проверяет readiness. При ошибке возвращает предыдущие release и SQLite snapshot. Hysteria и Xray при обычном обновлении не останавливаются.
