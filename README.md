# ecomkit

> **English:** `ecom` lets an AI agent search, fill a cart and order from
> Russian shops and delivery services, from the command line or over MCP. Every
> order needs your confirmation and stays within spending limits you set. The
> rest of this README is in Russian.

`ecom` даёт AI-агенту искать товары, собирать корзину и оформлять заказы в
российских магазинах и доставках. Работает как CLI и как MCP-сервер. Любой
заказ требует вашего подтверждения и укладывается в лимиты трат.

## Установка

Нужен Node 20.19+ или Bun.

```bash
npm install -g @slopworks/ecomkit
ecom doctor
```

## Использование

```bash
ecom mock search молоко
ecom mock product milk-1
ecom <provider> add <id> --qty 2
ecom <provider> checkout
```

`--json` выводит результат в JSON, `ecom --help` покажет все команды.
Токены сервиса сохраняются в системный keychain командой
`ecom login <provider>`; без keychain их можно передать переменными
`ECOM_<PROVIDER>_<KEY>`.

Подключить к Claude Code как MCP-сервер:

```bash
claude mcp add ecom -- ecom mcp
```

## Магнит

Каталог Магнит Доставки привязан к магазину. Найдите магазины, которые
доставляют по вашему адресу, и выберите нужный:

```bash
ecom magnit stores 55.7539 37.6208
ecom magnit store 777885
ecom magnit search молоко
```

Вход по номеру телефона и коду из SMS:

```bash
ecom login magnit
```

Пока доступны поиск и карточка товара.

## Покупки

`checkout` сначала показывает состав заказа, сумму и одноразовый код. Заказ
оформляется, только когда вы передаёте этот код обратно. Код действует 10
минут и перестаёт подходить, если корзина или адрес изменились.

По умолчанию можно потратить не больше 5 000 ₽ за заказ и 10 000 ₽ за сутки.
Лимиты задаются в рублях в `~/.config/ecomkit/config.json`:

```json
{ "limits": { "perOrder": 3000, "perDay": 8000 } }
```

Лимиты защищают от ошибок агента. От агента, которому доступен ваш shell, они
не спасут: он может поменять конфиг сам.

## Разработка

Нужны [Bun](https://bun.sh) и [uv](https://docs.astral.sh/uv/).

```bash
bun install
bun run check
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
