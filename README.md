# ecomkit

> **English:** ecomkit connects AI agents to Russian e-commerce and delivery
> services (Ozon, Samokat, Avito, …) through one CLI, `ecom`, which also runs
> as an MCP server. Checkout always needs explicit confirmation and respects
> spending limits. The rest of this README is in Russian.

Интеграции с e-commerce и доставками для AI-агентов: один CLI `ecom` и
MCP-сервер поверх общих адаптеров.

## Установка

Нужен Node ≥ 20 или Bun.

```bash
npm install -g @slopworks/ecomkit
ecom doctor
```

## Использование

```bash
ecom <provider> <команда> [аргументы] [--json]

ecom mock search молоко --json
ecom mock product milk-1
ecom mock checkout             # покажет сумму и код подтверждения
ecom mock checkout --confirm <код>

ecom login <provider>          # сохранить токены в системный keychain
ecom doctor                    # окружение, хранилище секретов, лимиты
ecom mcp                       # MCP-сервер по stdio
```

Команды провайдера: `search`, `product`, `cart`, `add`, `remove`, `checkout`,
`orders`, `order`. Провайдер может не поддерживать часть из них (например, у
Авито нет корзины) и добавлять свои.

### MCP

```json
{ "mcpServers": { "ecom": { "command": "ecom", "args": ["mcp"] } } }
```

Восемь тулов с параметром `provider`: `providers`, `search`, `product`,
`cart`, `cart_set`, `checkout`, `orders`, `order`. `checkout` помечен как
`destructiveHint`.

## Безопасность покупок

- Заказ оформляется в два шага: сначала `checkout` возвращает итог и код,
  заказ создаётся только повторным вызовом с этим кодом. Код привязан к
  составу корзины и сумме.
- Лимиты трат: на один заказ и за последние 24 часа. По умолчанию 5 000 ₽ и
  10 000 ₽; меняются в `~/.config/ecomkit/config.json`
  (`{ "limits": { "perOrder": 3000, "perDay": 8000 } }`, в рублях) или
  переменными `ECOM_LIMIT_PER_ORDER` и `ECOM_LIMIT_PER_DAY`.
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
