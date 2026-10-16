---
name: add-provider
description: Add a new service to ecomkit as a provider package, or extend an existing one with search, cart, checkout, orders or sign-in. Use when the user asks to integrate a shop or delivery service, or to add a capability to a provider.
---

# Adding a provider

A provider is a package `packages/provider-<id>` that implements the optional
methods of `Provider` from `packages/core/src/provider.ts`. Implement only what
the service supports; the CLI and MCP derive the available commands from
`capabilities(provider)`. `provider-magnit` is the reference implementation.

## Ground rules

- **Never place a real order.** `placeOrder` is built from the app's API and
  tested with fixtures only, unless the user explicitly says otherwise. Only
  `CheckoutGuard` calls `placeOrder`; `commands` never place orders.
- **Ask before touching the user's account.** Live calls to the service (cart
  changes, sign-in, anything that writes) happen only when the user agreed to
  them in this task. Reads used to discover the API are fine once allowed.
- **Never send made-up data to sign-in or payment endpoints** to test a
  hypothesis (fake phones, codes, attempt ids). Find the answer in the app's
  code instead and let the user run the real flow.
- **Live experiments are done by the main agent only.** Research agents read
  code and files; they never call the service.
- **The repo is public.** Fixtures and docs carry no phone numbers, emails,
  names, addresses, store or order numbers, tokens, device ids or machine paths
  from the real account. See the audit step below.

## 1. Research the API

The usual source is the service's mobile app (decompiled APK) plus a few
read-only live calls.

- Fan out research: several agents in parallel, each with exact files or a
  narrow question. Haiku agents here only have `Read`, so give them paths;
  use Sonnet with read-only `grep`/`find`/`cat` to search a tree.
- For each capability, write down: method, path, required headers (service,
  store, delivery type, device tag), body, the fields the response actually
  uses, and the units of every number.
- Look for what the app sends that is easy to miss: per-request headers that
  must stay the same across a multi-step flow (e.g. a device tag on every
  sign-in step), store or region selectors, delivery mode headers.
- Find out the units before writing code: prices in minor units or not,
  quantities in pieces or grams, weighted goods with a step.
- Pagination parameters of list endpoints are often not in the code; confirm
  them with one read-only call.

## 2. Scaffold the package

Mirror `packages/provider-magnit`:

- `package.json`: `"name": "@ecomkit/provider-<id>"`, `"private": true`,
  `"type": "module"`, `"exports": "./src/index.ts"`, the AGPL license field and
  `"@ecomkit/core": "workspace:*"`.
- `src/index.ts` exports `create<Name>Provider(): Provider` with `id`, `title`,
  `secrets` (every key the provider stores, with a label) and the methods.
- Register it in `apps/ecom/src/providers.ts` and add the dependency to
  `apps/ecom/package.json`, then `bun install`.
- Add `provider-<id>` to the `scopes:` list in `.github/workflows/pr-title.yml`.
- Split by concern as the package grows: `session.ts` (sign-in, tokens),
  `cart.ts`, `checkout.ts`, `orders.ts`, each turning API responses into core
  types with pure `to*` functions that tests call directly.

## 3. Implement capabilities

Ship one capability per PR, in this order, each usable on its own:

1. **Search and product** (`search`, `product`): map to `Product`; `Money` is
   integer minor units (`money(...)`), never floats. Put the portion or weight
   into the title when the price is per portion.
2. **Sign-in** (`login`, `Session`): `login(ask, ctx, { codeSent })`.
   - Ask for the phone and the code with `{ visible: true }`, and show the
     phone the code was sent to in the code prompt.
   - Retry a wrong code a few times, showing the service's message.
   - Store the pending sign-in (attempt id, phone, device tag) as a secret so
     `ecom login <id> --code` can finish it without sending a new SMS; delete it
     on success.
   - Keep tokens in `ctx.secrets`; refresh on 401 once, then raise
     `auth_required` telling the user which command to run.
   - After sign-in, sync whatever the account defines (delivery store,
     address) instead of requiring a manual choice.
3. **Cart** (`cart`, `setCartItem`): `setCartItem` sets an absolute quantity
   in the units the user sees; convert to the service's units (pieces, grams ×
   step) inside the provider. Verify live once that an item lands in the app's
   cart and shows as available.
4. **Orders** (`orders`, `order`): merge active and recent history, dedupe,
   map every status code to `OrderStatus` with a safe fallback for unknown
   ones; expose a payment link as `paymentUrl` when there is one.
5. **Checkout** (`checkoutPreview`, `placeOrder`):
   - The preview must contain everything the order will use: items, totals,
     address, delivery window, payment method. The guard binds its code to a
     digest of the whole preview, so anything left out can change unseen.
   - `placeOrder(confirmed)` re-reads the checkout, compares
     `previewDigest(current)` with the confirmed preview and throws
     `confirmation_required` on a mismatch, then posts the order.
   - Take address, slot and payment from what the user chose in the app; when
     something required is missing, throw `invalid_input` saying what to fix
     in the app. Refuse cases the CLI cannot show faithfully (several
     shipments, restrictions like a minimum order).
   - If the order request succeeds but reading the order back fails, still
     return a minimal `Order` built from the response.

Core changes (new optional fields on `CheckoutPreview`, `Order`, CLI output in
`apps/ecom/src/format.ts`) go in their own `feat(core)` PR before the provider
PR that uses them, with the mock provider and tests updated.

## 4. Fixtures and tests

- Fixtures live in `fixtures/<id>/`, one JSON response per file, named after
  the endpoint (`goods-search.json`, `order-<id>.json`).
- Never commit recorded responses as is. Cut them down to the fields the code
  reads and replace everything personal with synthetic values: phones like
  `79990000000`, `buyer@example.com`, `Москва, Тверская улица, 1`, order ids
  like `fy-CM000000001`, random UUIDs, a public store code.
- Tests are co-located `*.test.ts`. Provider tests pass a `fetch` that maps
  `method + pathname` to a fixture file and records requests, so tests can
  assert headers and bodies (quantities in grams, device tag reused across
  sign-in steps, the order body).
- Cover the edge cases found in research: weighted goods, unknown status
  codes, empty cart, missing payment method or email, changed preview, wrong
  code then right code, `--code` without a pending sign-in.

## 5. Docs

- Document the service in the provider's `notes` (sign-in, store or address,
  weighted goods, checkout requirements, limits) and in each command's
  `description`; `ecom <provider> --help` prints them. Say there when something
  is not verified end to end.
- `README.md` stays minimal and is in Russian: only add or update the
  service's row in the `## Сервисы` matrix, with a footnote for anything not
  verified end to end. Never add a section per service.
- Everything else, including PR titles and bodies, is in English.

## 6. Ship

- Branch `<type>/<task>` per PR, under ~300 changed lines; conventional title
  with the provider scope, e.g. `feat(provider-<id>): keep a cart in the
delivery store`.
- When PRs depend on each other, stack them: branch each one off the previous
  branch and never rebase; the user merges the stack on GitHub.
- Before every PR:
  1. `bun run check` is green.
  2. A subagent audits the **whole repository**, not only the diff: all
     tracked files, `git log -p HEAD`, and the PR title and body, for phone
     numbers, emails, names, nicknames, addresses, store and order numbers,
     tokens, env values, `/Users/` paths and links to private workspaces.
  3. `gh pr create --fill`, no attribution lines, then report the URL.
- Tell the user which parts were verified live and which only by fixtures.
