# Модель безопасности

## Основные свойства

- вход владельца только по WebAuthn passkey с user verification;
- HTTPS обязателен в production, cookie `HttpOnly`, `Secure`, `SameSite=Strict`;
- секреты credentials — AES-256-GCM, master key mode `0600`;
- passkeys, subscription URLs и routing URLs сохраняются при переносе вместе с master key и тем же доменом;
- invitation, subscription, route и XHTTP URLs не попадают в Nginx access log;
- `/internal/*` закрыт на публичном Nginx edge;
- Xray API, Hysteria stats и root-agent слушают только localhost/Unix socket;
- root-agent валидирует action, service, engine и каждый filesystem path;
- scoped token `status:read` видит только минимальный status endpoint; owner dashboard доступен только browser session владельца;
- raw bootstrap token не сохраняется в WebAuthn challenge, просроченные challenge удаляются, число незавершённых challenge ограничено;
- активация и отзыв устройства завершаются в SQLite только после успешной синхронизации движка; незавершённые операции сохраняются в outbox и повторяются после рестарта;
- release archive имеет detached Minisign signature, проверяемую installer/updater до распаковки;
- временный IP edge разрешает только setup API, setup SPA и статические ресурсы; WebAuthn и обычная панель до final domain снаружи недоступны;
- setup token проверяется до DNS lookup и root-action, а DNS повторно сверяется с установленным public IPv4 внутри привилегированного finalize-скрипта;
- все мутации создают audit entries; passphrases и raw secrets туда не передаются;
- история посещённых доменов не собирается.

## Threat model v1

Matreshka защищает от случайной утечки URL в журналы, компрометации одной subscription URL после revoke, произвольного command execution через control plane и потери настроек при штатном/нештатном update.

Matreshka не защищает от полного root-компромисса VPS, вредоносного владельца, компрометации DNS/регистратора или устройства с активной подпиской. Root на сервере может прочитать master key и расшифровать credentials.

## Публичный репозиторий

Исходники публикуются до field gate, чтобы установка могла скачивать подписанные GitHub Releases без GitHub-авторизации. Публичность исходников не означает production-ready: состояние релиза и непроверенные полевые сценарии перечислены в `STATUS.md`.

Release signing key создан вне репозитория; public key закоммичен, private key хранится локально с mode `0600` и в GitHub environment secret. Перед сменой visibility проверяются рабочее дерево и вся Git-история. `servers.rtf`, SSH keys, реальные profiles, домены установки и API tokens в monorepo не переносятся.

Уязвимости до публичного релиза следует сообщать владельцу приватно, не создавая публичный issue с operational details.
