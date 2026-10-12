# ecomkit

> **English:** ecomkit connects AI agents to Russian e-commerce and delivery
> services (Ozon, Samokat, Avito, …) through one CLI, `ecom`, which also runs
> as an MCP server. Checkout always needs explicit confirmation and respects
> spending limits. The rest of this README is in Russian.

Интеграции с e-commerce и доставками для AI-агентов: один CLI `ecom` и
MCP-сервер поверх общих адаптеров.

## Установка

Нужен Node ≥ 20.19 или Bun.

```bash
npm install -g @slopworks/ecomkit
ecom doctor
```

## Использование

```bash
ecom <provider> <команда> [аргументы] [--json]

ecom mock search молоко --json
ecom mock product milk-1
ecom <provider> add <id> --qty 2
ecom <provider> checkout       # покажет итог и код подтверждения
ecom <provider> checkout --confirm <код>

ecom login <provider>          # сохранить токены в системный keychain
ecom doctor                    # окружение, хранилище секретов, лимиты
ecom mcp                       # MCP-сервер по stdio
```

Команды провайдера: `search`, `product`, `cart`, `add`, `remove`, `checkout`,
`orders`, `order`. Провайдер может не поддерживать часть из них (например, у
Авито нет корзины) и добавлять свои.

`mock` — тестовый провайдер на фикстурах: корзина и заказы живут в памяти
процесса, поэтому полный сценарий покупки работает внутри `ecom mcp`.

### MCP

```json
{ "mcpServers": { "ecom": { "command": "ecom", "args": ["mcp"] } } }
```

Девять тулов с параметром `provider`: `providers`, `search`, `product`,
`cart`, `cart_set`, `checkout`, `orders`, `order` и `command` для команд
конкретного провайдера. `checkout` и `command` помечены как
`destructiveHint`.

## Безопасность покупок

- Заказ оформляется в два шага: сначала `checkout` возвращает итог и код,
  заказ создаётся только повторным вызовом с этим кодом. Код одноразовый,
  действует 10 минут и привязан к составу корзины, сумме и адресу; новый
  предпросмотр отменяет прежние коды.
- Лимиты трат: на один заказ и за последние 24 часа. По умолчанию 5 000 ₽ и
  10 000 ₽; задаются в `~/.config/ecomkit/config.json`
  (`{ "limits": { "perOrder": 3000, "perDay": 8000 } }`, в рублях).
  Переменные `ECOM_LIMIT_PER_ORDER` и `ECOM_LIMIT_PER_DAY` могут их только
  понизить.
- История трат и выданные коды лежат в `~/.local/state/ecomkit/guard.json`;
  параллельные покупки из разных процессов проходят по одной. Если сервис
  явно отклонил заказ, сумма не учитывается; если исход неизвестен (таймаут,
  ошибка 5xx, обрыв), сумма учитывается в лимите 24 часа — проверьте заказы
  у сервиса.
- Лимиты защищают от ошибок агента, а не от агента с полным доступом к
  shell: такой агент может изменить конфиг сам.
- Секреты хранятся в системном keychain (Bun.secrets или `@napi-rs/keyring`).
  Переменные вида `ECOM_<PROVIDER>_<KEY>` имеют приоритет.

## Разработка

Нужны [Bun](https://bun.sh) и [uv](https://docs.astral.sh/uv/) (для
`bun run reuse`).

```bash
bun install
bun run check
bun run ecom -- mock search молоко
```

Устройство репозитория и правила — в [CLAUDE.md](CLAUDE.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
