# CONTEXT: botforje-js — Current State & What's Pending

This document describes the **actual implemented state** of the project as of today, plus what remains pending. Read this before contributing or making design decisions.

## What is botforje-js?

A config-driven WhatsApp bot framework (Node.js/TypeScript). All bot behavior is defined in YAML configuration files — no code required to add or modify bots. Built on `whatsapp-web.js`.

## Implemented Features

### Core engine
- **Multi-bot fleet**: Run multiple WhatsApp bots from a single daemon process.
- **Actions**: Reusable behavior pipelines (message, request, location steps) with optional cooldown guards.
- **Graphs**: Conversation state machines with fuzzy-matched edge transitions, root/fallback nodes, and timeout-based session expiry.
- **Session persistence**: Graph sessions persist in SQLite across daemon restarts.
- **Template variables**: `{{senderPhone}}`, `{{message}}`, `{{bot.id}}`, `{{variables.*}}` in action message bodies.

### Config loading
- **Inline YAML**: All entities defined in `config.yml`.
- **Modular files**: Actions, graphs, and bots in separate `actions/`, `graphs/`, `bots/` directories.
- **`!include` support**: YAML includes for step lists.
- **Hot-reload**: Config changes detected and reloaded without restart.
- **Validation**: Schema, cross-reference, and uniqueness checks via `botforje-js validate`.

### CLI commands
- `daemon` / `start` — start the bot fleet.
- `auth <botId>` — authenticate a bot via WhatsApp QR code.
- `status` — show all bots and their session status.
- `validate` — validate config files.
- `lock` / `unlock` — API auth protection (SHA-256 key).
- `guide` — AI agent configuration reference.

### REST API
- Health, auth, bots, messages, sessions, status, config endpoints.
- Bearer token (admin key) or session cookie authentication.
- API can be enabled/disabled via `port` config.

### WhatsApp integration
- WhatsApp Web multi-session support.
- QR code authentication with SSE event streaming.
- Per-bot message queue with configurable delay.
- Read receipts, group message filtering, sender whitelist/blacklist.

## What is NOT yet implemented

### Scope-based multi-tenancy (DESIGN APPROVED — NOT IMPLEMENTED)

**Decision:** Entities (actions, graphs, bots) can carry an optional `scope`. This enables a single botforje daemon to host entities for multiple independent clients without name collisions.

**Design summary (see [roadmap.md](roadmap.md) Phase 1 & Phase 5 for full details):**

| Aspect | Design |
|--------|--------|
| Scope source | Subdirectory path in file-based config: `actions/client-a/greet.yml` → scope = `client-a` |
| Inline config | Unscoped only (admin-only entities). Inline entities live in `config.yml` root keys. |
| Isolation | Strict — entities reference only same-scope entities. Unscoped ↔ unscoped, scoped ↔ same scope. |
| Name uniqueness | Names unique within a scope. Same name across scopes = OK. |
| Auth session scope | `sessions` table gets a `scope` column (nullable string). `NULL` = admin, `"client-a"` = scoped. |
| Scoped session creation | `POST /api/auth/sessions` (admin-protected) creates a scoped session. |
| API enforcement | Routes filter by session scope. Admin sees all; scoped sees only its own scope. |

**Pending changes to implement scope:**

| What | Status |
|------|--------|
| `src/config/scope.ts` — `entityKey`, `parseEntityKey`, `canAccess` helpers | NOT STARTED |
| `src/bot.ts` — add `scope` and `name` fields; `id` becomes composite `scope/name` | NOT STARTED |
| `src/actions/action.ts` — add `scope` and `name` to `ActionDef` | NOT STARTED |
| `src/graph/graph.ts` — add `scope` and `name` to `GraphDef` | NOT STARTED |
| `src/config/yaml.ts` — recursive directory loading with scope derivation | NOT STARTED |
| `src/config/mapper.ts` — parse composite keys, pass scope/name to constructors | NOT STARTED |
| `src/config/validation.ts` — scope-based uniqueness, strict cross-ref validation | NOT STARTED |
| `src/auth/service.ts` — rename `scope_bot_ids` → `scope` column (single nullable string) | NOT STARTED |
| `src/api/server.ts` — middleware attaches `Session` to `req` with scope | NOT STARTED |
| `src/api/routes/*` — scope filtering on all entity routes | NOT STARTED |
| `src/api/routes/auth.ts` — `POST /api/auth/sessions` scoped session endpoint | NOT STARTED |
| `src/api/routes/sessions.ts`, `messages.ts`, `bots.ts`, `status.ts` — scope-aware lookups | NOT STARTED |
| `src/whatsapp/session.ts` — `clientId` handling for composite IDs (slashes in paths) | NOT STARTED |
| `src/config/schema.ts` — no YAML schema changes needed (scope derived from path) | DONE (no change) |
| Tests (unit + integration + fixtures) for all of the above | NOT STARTED |
| `config.example.yml` — document scope via subdirectories | NOT STARTED |
| `roadmap.md` — updated Phase 1 & Phase 5 to reflect `scope` single string | DONE |

### CLI `create` command
**Status: DEFERRED — needs replanning.** The original concept assumed numeric auto-increment IDs which have been scrapped. With scope-based namespacing via subdirectories, the `create` command needs a fresh design. A scoped entity would require a `--scope` flag to determine which subdirectory to write to. Pending a new design pass.

### Other roadmap phases (not yet started)
- **Phase 2** — Web UI v1 (viewing and manual control)
- **Phase 3** — AI integration in the graph
- **Phase 3.1** — Unified state + `script` step type
- **Phase 3.2** — Request response capture (`{{response.*}}`)
- **Phase 4** — Web UI v2 (full configuration)
- **Phase 5** — Federated login service integration (JWT verification)

## Architecture decisions (already locked in)

- **Botforje does not manage users**. It knows a single admin key, plus scoped session tokens.
- **No numeric IDs**. Entities are identified by `(scope, name)` tuple. The internal `id` is a composite string `scope/name`.
- **No separate `scope` YAML field**. Scope comes from file path (subdirectory). Inline config is unscoped-only.
- **Strict scope isolation**. No shared templates between admin and clients. Each scope is a complete self-contained namespace.
- **The SaaS login service is a separate project**. botforje only trusts tokens and filters by scope.

## Project layout

```
src/
  cli.ts                 # CLI entry point (Commander.js)
  bot.ts                 # Bot domain model
  fleet.ts               # BotFleet — orchestration root
  config/                # Config loading, schema, mapping, validation, watching
    schema.ts
    yaml.ts
    mapper.ts
    validation.ts
    watcher.ts
  actions/               # Action domain types + cooldown + request
    action.ts
    cooldown.ts
    request.ts
  graph/                 # Graph domain + executor + state (SQLite)
    graph.ts
    executor.ts
    state.ts
  messages/              # Message contracts, inbox, outbox
    contracts.ts
    inbox.ts
    outbox.ts
  whatsapp/              # WhatsApp channel implementation + session manager
    client.ts
    session.ts
  api/                   # REST API server + routes
    server.ts
    routes/
  auth/                  # Auth service (API key management)
    service.ts
  helpers/               # Logger, fuzzy matching, data dir
  commands/              # CLI command implementations
tests/
  unit/
  integration/
  fixtures/              # YAML config fixtures for testing
```
