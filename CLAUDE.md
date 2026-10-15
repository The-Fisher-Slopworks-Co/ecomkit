## Project

ecomkit: e-commerce and delivery integrations (Ozon, Samokat, Avito, …) for
AI agents, shipped as one CLI, `ecom`, that also serves MCP over stdio.
Published to npm as `@slopworks/ecomkit`. See `README.md` for usage.

### Commands

```bash
bun install        # also installs the lefthook pre-commit hook
bun run check      # typecheck + lint + format:check + knip + reuse + test — before every commit
bun run typecheck  # runtime code against @types/node, then tests against bun-types
bun run lint       # oxlint (config: .oxlintrc.json)
bun run format     # prettier --write (config: .prettierrc.json)
bun run knip       # unused files/exports/deps (config: knip.ts)
bun run reuse      # REUSE lint via uvx; needs uv on the machine
bun run test       # bun test; one file: `bun test packages/core/src/money.test.ts`
bun run build      # bundles apps/ecom into apps/ecom/dist/ecom.js for Node ≥ 20.19
bun run smoke      # drives the built bundle through CLI + MCP; ECOM_RUNTIME=bun, ECOM_BUNDLE=<path> to vary
bun run ecom -- mock search milk --json   # the CLI from source
```

### Layout

- `packages/core` (`@ecomkit/core`): shared types (`Product`, `Cart`, `Order`, `Address`, `Money`), the `Provider` interface, HTTP client, `SecretStore` (`ECOM_<PROVIDER>_<KEY>` env first, then Bun.secrets or `@napi-rs/keyring`, whichever answers a probe), spending limits and the checkout guard with its state file, config paths.
- `packages/provider-*` (`@ecomkit/provider-<id>`): one adapter per service. Implements the optional methods of `Provider` it supports, plus provider-specific `commands`. `provider-mock` serves `fixtures/mock/`.
- `apps/ecom` (`@slopworks/ecomkit`): the CLI. `actions.ts` is the one place the CLI and the MCP server call providers through; `providers.ts` is the registry. Publish with `bun publish` from `apps/ecom`: it rewrites `workspace:` specifiers, and `prepack` builds the bundle and copies the root README and LICENSE in.
- `fixtures/<provider>/`: recorded API responses for tests.

### Conventions

- **Runtime code is portable.** No `Bun.*` and no `bun:*` imports outside tests; `tsconfig.json` only has `@types/node`, oxlint enforces the rest. The bundle is packed, installed and smoke-tested on Node 20.19, Node 22 and Bun in CI. Keep to ES2023 and Node 20.19 APIs.
- **Money** is integer minor units (`{ amount: 12990, currency: "RUB" }` is 129.90 ₽). Never floats.
- **Checkout is two-step.** `checkout` without a confirmation code returns the preview and a single-use code valid for 10 minutes, bound to a digest of the whole preview. A new preview voids older codes. Confirming re-reads the preview, re-checks the limits and records the spend as pending before `placeOrder`, all under a lock on `guard.json`; a definite rejection (`EcomError`, HTTP 4xx) drops the record, anything else keeps it counted. Only `CheckoutGuard` calls `placeOrder`; provider `commands` must never place orders.
- **Limits** come from `config.json`; environment variables may only lower them.
- **Errors** are `EcomError` with a `code`; the CLI prints `{ "error": { code, message } }` under `--json` and exits 1.
- **No code comments.** Names and tests carry the meaning.
- **Tests** are co-located `*.test.ts` run by `bun test`. Provider HTTP goes through `ctx.http`, so tests pass a `fetch` (on `Runtime`, or to `createHttpClient`) that serves `fixtures/`.
- The license is covered by `REUSE.toml`; source files carry no SPDX headers.

### Definition of done

- **Everything in the repo is written in English** — code, comments, docs, commit messages, issues and PRs (title and body), whatever language the task was discussed in. The only exceptions are localization and `README.md`, which is in Russian with an English note on top.
- **Never commit to main.** Every task starts on a fresh branch off `origin/main`, named `<type>/<short-task>` — `fix/`, `feat/`, `refactor/`, `chore/`.
- **One task = one branch = one PR.** Past ~300 changed lines, split it into several PRs. `pr-size.yml` labels every PR `size:XS`…`size:XXL`; **`size:XL` or `size:XXL` means split the PR**, not "explain why it is large".
- **PR title is the squash commit subject:** conventional commit with a scope, enforced by `.github/workflows/pr-title.yml`.
  - Type: `feat` `fix` `refactor` `chore` `docs` `test` `ci` `perf` `revert`.
  - Scope (required): `core` `ecom` `provider-lifemart` `provider-magnit` `provider-mock` `fixtures` — or `deps` `github` `release`. A new package (every `provider-*`) means adding it to the `scopes:` list in that workflow.
  - Subject: lowercase start, imperative, no trailing period.
  - The body describes this PR alone, following the PR template.
- **No AI attribution.** No `Assisted-by:` / `Co-Authored-By: <LLM>` trailers in commits, no agent as commit author or committer, and no "Generated with/by …" lines or agent-platform links in PR bodies. The PR title workflow checks the title, the body and every commit of the PR.
- **Before opening:** `bun run check` green, then `gh pr create --fill`; report the PR URL as the final step of the task.
- **Never merge locally.** Merging happens on GitHub, squash only.
