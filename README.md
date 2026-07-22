# Botforje-js

[![npm version](https://img.shields.io/npm/v/botforje-js.svg)](https://www.npmjs.com/package/botforje-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/felixzsh/botforje/pulls)

**Create multiple WhatsApp bots without writing code** - Just configure in YAML!

Botforje-js lets you create and manage multiple WhatsApp bots by simply editing a configuration file. No programming required! Built on top of [WhatsApp Web JS](https://github.com/pedroslopez/whatsapp-web.js).

## What Can You Do?

- **Multiple Bots**: Run several WhatsApp bots from one server
- **YAML Configuration**: Define bot behavior in simple YAML files
- **Actions & Graphs**: Build conversation state machines with fuzzy-matched edges
- **Scopes**: Multi-tenant namespacing — multiple clients can have bots with the same name
- **Requests**: Connect to your existing apps via HTTP
- **REST API**: Send messages programmatically (optional)
- **Systemd Service**: Run as a proper system service with auto-restart

## Quick Start

### Prerequisites

**System Requirements:**
- **Node.js** 22.13+ and **npm/pnpm**
- **Chromium browser** installed on your system
- **For Linux systemd service mode**: `xvfb` (X Virtual Framebuffer) for headless operation


### 1. Install

```bash
npm install -g botforje-js
```

### 2. Setup & Start as System Service

The daemon is configured automatically during install. Start it with:

```bash
# Start the service
systemctl --user start botforje-js

# Enable auto-start on boot
systemctl --user enable botforje-js
```

### 3. Authenticate Your Bot

```bash
botforje-js auth <botId>
```

Shows a QR code to link your WhatsApp account. Once scanned, the bot is authenticated and ready.

### 4. Check Status

```bash
botforje-js status
journalctl --user -u botforje-js -f    # real-time logs
```

## Configuration Guide

### Global Configuration

Configure system-wide settings at the top level of `config.yml`. Entity definitions (actions, graphs, bots) can either live inline in this file (unscoped only) or in separate files under `actions/`, `graphs/`, and `bots/` directories.

```yaml
chromium_path: "/usr/bin/chromium"  # Path to Chromium/Chrome browser
port: 3000                         # REST API port (set to enable the API)
address: "127.0.0.1"              # Bind address (127.0.0.1 = localhost only, 0.0.0.0 = all interfaces)
log_level: "info"                  # Global log level: info, debug, warn, error
default_timeout: 300               # Global default timeout for graph sessions (seconds)
# trusted_issuers:                 # Optional — public keys for federated login (see Phase 5 in roadmap)
#   - "https://login.example.com/.well-known/jwks.json"
```

### File Organization

Entities can be organized with optional **scopes** using subdirectories:

```
~/.config/botforje-js/
  config.yml               # global settings + optional unscoped inline entities
  actions/                 # unscoped actions (admin)
    greet.yml
    client-a/              # scoped actions (client-a)
      greet.yml
  graphs/                  # unscoped graphs
    client-a/              # scoped graphs
      faq.yml
  bots/                    # unscoped bots
    client-a/              # scoped bots
      support.yml
```

File names become the entity name. The subdirectory (e.g. `client-a`) is the scope. See [Scopes & Multi-Tenancy](#scopes--multi-tenancy) above for details.

### Architecture

Botforje-js uses — **Actions**, **Graphs**, and **Bots** — all defined in a single YAML map or spread across modular files in `actions/`, `graphs/`, and `bots/` directories.

- **Actions**: Reusable behaviors — text replies, request calls, cooldowns. Not tied to any specific bot.
- **Graphs**: Conversation state machines. A graph owns a set of nodes connected by fuzzy-matched edges. Each bot references exactly one graph.
- **Bots**: WhatsApp numbers that reference a single graph and have per-bot settings.

```
Bot
  └─ Graph (one per bot)
       └─ Nodes
            └─ Edges (transitions based on fuzzy-matched user input)
                 └─ Actions
```

### Scopes & Multi-Tenancy

Entities (actions, graphs, bots) carry an optional **scope** for multi-tenant isolation. Scope is derived from the subdirectory path in your config:

```
~/.config/botforje-js/
  config.yml                          # global settings (no entities)
  actions/
    greet.yml                         # unscoped — admin only
    client-a/
      greet.yml                       # scoped to "client-a"
    client-b/
      greet.yml                       # scoped to "client-b" — same name, different scope
  graphs/
    client-a/
      faq.yml                         # scoped graph referencing client-a actions
  bots/
    client-a/
      support.yml                     # scoped bot for client-a
    client-b/
      support.yml                     # scoped bot for client-b — same name, OK
```

**Rules:**
- Entities in root directories (`actions/greet.yml`) are **unscoped** — visible only to the admin key.
- Entities in subdirectories (`actions/client-a/greet.yml`) are **scoped** — visible only within that scope.
- Names must be unique within their scope. Same name in different scopes is allowed.
- **Strict isolation**: scoped entities can only reference other entities in the same scope. Entities without a scope can only reference other unscoped entities.
- **Inline config** in `config.yml` only supports unscoped entities.

This design enables a single botforje daemon to host hundreds of bots for independent clients without name collisions — each client's entities live in their own scope.

### Actions

Actions are the building blocks, defined as a **pipeline of ordered steps**. Each action can have an optional `guards` block (for rate-limiting) and a `steps` array that runs in sequence.

Replies support template variables:
- `{{senderPhone}}` — the sender's phone number
- `{{message}}` — the incoming message text
- `{{bot.id}}` — the bot's ID
- `{{variables.name}}` — graph session variables

```yaml
actions:
  greet:
    steps:
      - message:
          body: "Hello! How can I help you?"

  escalate:
    guards:
      cooldown:
        duration: 120
        on_blocked:
          - message:
              body: "You already requested a human agent. Please wait."
    steps:
      - message:
          body: "Connecting you to a human agent."
      - request:
          name: escalate-human
          url: "https://api.example.com/support/escalate"
          method: POST
          headers:
            Authorization: "Bearer your-api-token"
          timeout: 10000
          retry: 3

  lead-notify:
    steps:
      - request:
          name: lead-capture
          url: "https://crm.example.com/leads"
          method: POST
          headers:
            X-API-Key: "your-crm-key"

  # Send a WhatsApp location pin (combined with a text message)
  send-office:
    steps:
      - message:
          body: "Here is our office."
      - location:
          latitude: 19.4326
          longitude: -99.1332
          name: "Main Office"
          address: "Av. Reforma 123, CDMX"
          url: "https://maps.example.com/office"
          description: "Open Mon-Fri 9-18h"

  # Location-only action (no text message)
  send-store-only:
    steps:
      - location:
          latitude: 19.4326
          longitude: -99.1332
          name: "Store"
```

**Step types:**

| Step | Description |
|---|---|
| `message` | Sends a text message (optionally to a different recipient via `to`) |
| `request` | Fires an HTTP request |
| `location` | Sends a WhatsApp location pin |

When a request fires, it sends a JSON payload:

```json
{
  "senderPhone": "521234567890",
  "senderName": "John Doe",
  "message": "I'm interested in your product",
  "timestamp": "2025-01-09T01:45:00Z",
  "botId": "support-bot",
  "botName": "support-bot",
  "requestName": "lead-capture",
  "metadata": {}
}
```

### Graphs

Graphs define multi-step conversations. Each graph has a `root` node, optional `timeout`, optional `fallback` for unmatched input, and a map of `nodes` connected by `edges`.

```yaml
graphs:
  faq-support:
    root: menu
    timeout: 300                   # Session TTL (seconds) — session dies after inactivity
    fallback: invalid         # Where to go if user sends an unexpected response
    nodes:
      menu:
        action: menu
        edges:
          - match: "1, hours, schedule, time, hours"
            goto: hours
          - match: "2, catalog, product, brochure"
            goto: catalog
          - match: "3, human, agent, person, talk, speak"
            goto: escalate
          - match: "4, price, pricing, cost"
            goto: pricing
          - match: "0, exit, bye, goodbye, end"
            goto: farewell
          - goto: invalid           # Default edge (no 'match'): catches everything else

      hours:
        action: hours
        edges:
          - match: "menu, back, return, volver"
            goto: menu
          - match: "0, exit"
            goto: farewell
          - goto: invalid

      catalog:
        action: catalog
        edges:
          - match: "menu, back"
            goto: menu
          - match: "0, exit"
            goto: farewell
          - goto: invalid

      escalate:
        action: escalate            # This action has cooldown
        edges:
          - match: "menu, back"
            goto: menu
          - match: "0, exit"
            goto: farewell
          - goto: invalid

      pricing:
        action: pricing
        edges:
          - match: "menu, back"
            goto: menu
          - match: "0, exit"
            goto: farewell
          - match: "interested, buy, order, quote"
            goto: lead
          - goto: invalid

      lead:
        action: lead-notify
        edges:
          - match: "menu, back"
            goto: menu
          - goto: farewell

      invalid:
        action: invalid
        edges:
          - goto: menu               # Always return to menu after invalid input

      farewell:
        action: farewell
        edges: []                    # No edges — session stays alive until timeout
```

**Graph entry behavior:**

When a sender has no active session, the bot automatically:
1. Creates a new session
2. Enters the graph's `root` node
3. Executes the root node's action
4. Stores the root node in the visited history
5. Attempts to resolve the user's original message using the normal node resolution algorithm

This means the user's first message is never discarded — it can match a root edge and transition to a different node right away.

- **`match`** — comma-separated phrases. Fuzzy-matched against the user's message with the configured threshold.
- **`fuzzy_threshold`** — controls strictness. `0.3` = strict, `0.6` = moderate (default), `0.9` = loose.
- **`timeout`** — seconds of inactivity before the session expires. Defaults to global `default_timeout`.
- **`fallback`** — where to redirect if no edge matches. Without one, mismatched messages are silently ignored.
- **`edges: []`** — a node with no edges does not destroy the session; the user can still navigate to any previously visited node from its own edges. Sessions only end via timeout.

### Cooldowns

Set a `guards.cooldown.duration` (seconds) on any action to prevent the same sender from triggering it repeatedly. Provide an `on_blocked` pipeline that runs when the guard blocks the action.

```yaml
actions:
  escalate:
    guards:
      cooldown:
        duration: 120
        on_blocked:
          - message:
              body: "You already requested an agent. Please wait."
    steps:
      - message:
          body: "Connecting you to an agent."
      - request:
          name: escalate-human
          url: "https://api.example.com/support/escalate"
```

Cooldowns are per-sender, per-action — different senders are tracked independently. The `on_blocked` pipeline can contain any step types (message, request, location).

### Location Actions

Send a WhatsApp location pin to the user. A `location` step can be combined with other steps in the pipeline.

```yaml
actions:
  send-office:
    steps:
      - message:
          body: "Here is our office."
      - location:
          latitude: 19.4326
          longitude: -99.1332
          name: "Main Office"
          address: "Av. Reforma 123, CDMX"
```

Required: `latitude` (-90 to 90), `longitude` (-180 to 180). Optional: `name`, `address`, `url`, `description`.

### Bot Settings

A bot references exactly one graph.

```yaml
bots:
  support-bot:
    graph: faq-support
    settings:
      queue_delay: 1500
      ignore_groups: true
      ignored_senders:
        - "status@broadcast"
```

See [`config.example.yml`](config.example.yml) for a full working configuration.

## Service Management

Once installed and configured, manage your bot service:

```bash
# Check service status
systemctl --user status botforje-js

# View logs in real-time
journalctl --user -u botforje-js -f

# Restart service
systemctl --user restart botforje-js

# Stop service
systemctl --user stop botforje-js

# Disable auto-start
systemctl --user disable botforje-js
```

## Troubleshooting

**Service not starting?**
- Check if `xvfb` is installed: `which xvfb`
- Verify config file: `cat ~/.config/botforje-js/config.yml`
- Check service logs: `journalctl --user -u botforje-js -n 50`

**QR code not showing?**
- Ensure no other WhatsApp sessions are active
- Restart the service: `systemctl --user restart botforje-js`

**Messages not responding?**
- Check bot status in logs
- Verify the bot's `graph` field references an existing graph
- Test with exact phrases first, then tune `fuzzy_threshold`

**Request not working?**
- Test your endpoint with tools like Postman
- Check logs for timeout/connection errors
- Verify request URL and headers
