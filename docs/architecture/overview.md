# AgentSteve Architecture Overview

## What This System Does

`AgentSteve` is a TypeScript Node.js service that runs a Discord bot and a small internal Express API in the same process. The bot helps Minecraft server owners through a routed agent stack. The API supports trusted callbacks and setup workflows for Google OAuth and Pterodactyl server access.

The active production path today is:

1. Discord mention enters `src/index.ts`.
2. `src/router.ts` classifies the request.
3. The request goes to `nano`, `moderate`, or the placeholder `complex` path.
4. `moderate` can read Google Docs, create new Paper plugins, or perform Pterodactyl power actions.
5. Results are persisted through Prisma and sent back to Discord.

## Documentation Map

- [discord-runtime.md](discord-runtime.md) - Discord lifecycle, message gating, attachments, Google Doc pre-read, clarification state, and replies.
- [agent-routing.md](agent-routing.md) - Classifier, router, nano responder, moderate responder, tool loop, and routing limitations.
- [plugin.md](plugin.md) - New-plugin generation pipeline, specialist agents, Maven build loop, GitHub source persistence, and plugin records.
- [google-docs.md](google-docs.md) - Google OAuth token storage and Google Docs reading.
- [server-management.md](server-management.md) - Pterodactyl server access checks, power operations, file tools, and websocket console capture.
- [internal-api.md](internal-api.md) - Internal Express API, auth middleware, and controllers.
- [persistence-and-files.md](persistence-and-files.md) - Prisma models, local download/build/log folders, and local state.
- [workflow-orchestrator.md](workflow-orchestrator.md) - In-progress workflow planner in `src/agents/workflow.ts`.

## How It Works

`app.ts` imports the Discord runtime and Express API server. Both modules run immediately on import.

The Discord runtime owns the user-facing request lifecycle. It creates guild records on startup and guild join, accepts only administrator mentions, gathers recent chat context, stores attachments, pre-reads Google Docs when possible, opens websocket connections for known servers, and then calls the router.

The router uses the classifier's JSON flags to pick a responder:

- `nano` for plain-text answers that do not require tools.
- `moderate` for tool-backed work and higher-capability reasoning.
- `complex` for large or multi-step work, but this responder is currently only a placeholder.

The moderate responder exposes a small tool set to the model:

- `respond`
- `createNewPlugin`
- `clarify`
- `readDoc`
- `serverPower`
- built-in `web_search`

The plugin pipeline is the deepest workflow. It routes complexity, optionally designs tasks, generates or edits an in-memory project manifest, builds with Maven, attempts bounded build repair, stores the JAR in downloads, persists source to GitHub, reviews the project, and writes a `Plugin` row.

The internal API is intended for trusted services only. Every route is guarded by `Authorization: Bearer <STEVE_INTERNAL_KEY>`.

## System Map

```mermaid
flowchart TD
    App[app.ts] --> Discord[src/index.ts Discord runtime]
    App --> Api[src/api/server.ts Internal Express API]

    Discord --> Ready[clientReady and guildCreate setup]
    Ready --> Guilds[(Prisma Guild rows)]
    Ready --> DownloadsDir[src/tools/downloads/guildId]

    Discord --> Mention[messageCreate mention]
    Mention --> Gate[bot/everyone/guild/admin/concurrency gates]
    Gate --> Context[getPastChats]
    Gate --> Attachments[download attachments]
    Gate --> KnownServers[load guild servers]
    KnownServers --> WS[pterodactylWS.connect]
    Gate --> GDocPreRead[gdoc.read pre-read for doc links]
    Gate --> ClarifyState{clarification active?}

    ClarifyState -->|moderate| Moderate[src/agents/moderate.ts]
    ClarifyState -->|complex| ComplexPlaceholder[complex placeholder reply]
    ClarifyState -->|none| MainRouter[src/router.ts]

    MainRouter --> Classifier[src/agents/classifier.ts]
    Classifier --> RouteChoice{routing flags}
    RouteChoice -->|no flags| Nano[src/agents/nano.ts]
    RouteChoice -->|tool/planning flags| Moderate
    RouteChoice -->|large/multi-server/debug flags| ComplexPlaceholder

    Nano -->|respond tool| DiscordReply[sendMsgDiscord]
    Nano -->|moderate tool| Moderate

    Moderate -->|respond| DiscordReply
    Moderate -->|clarify| ClarificationReply[send clarification]
    ClarificationReply --> Clarifications[(clarifications in memory)]
    Moderate -->|createNewPlugin| PluginPipeline[src/pipelines/plugin.ts]
    Moderate -->|readDoc| GDocs[src/tools/google.ts]
    Moderate -->|serverPower| ServerPower[src/tools/server/server.ts]

    PluginPipeline --> PluginAgents[src/agents/plugins/*]
    PluginPipeline --> PluginBuild[src/tools/plugin.ts]
    PluginBuild --> Maven[Maven build workspace]
    PluginBuild --> GitHub[GitHub source repo]
    PluginBuild --> Downloads[(Download row and JAR)]
    PluginPipeline --> Plugins[(Plugin row)]

    ServerPower --> PteroHTTP[Pterodactyl HTTP API]
    WS --> ConsoleLines[(ConsoleLine rows)]
    GDocs --> GoogleAPI[Google Docs API]

    Api --> Auth[src/api/auth.ts]
    Auth --> ApiRoutes[src/api/routes.ts]
    ApiRoutes --> GuildCheck[guildChecker]
    ApiRoutes --> OAuth[googleOAuth]
    ApiRoutes --> ServerAccess[serverAccessChecker]
    OAuth --> GuildUser[(GuildUser token)]
    ServerAccess --> ServerAdd[server.addNew]
    ServerAdd --> Servers[(Server rows)]
```

## Major Runtime Layers

### Entrypoints

- `app.ts` starts the bot and API by importing modules.
- `src/index.ts` owns Discord runtime behavior.
- `src/api/server.ts` owns the internal Express server.

### Agents

- `src/agents/classifier.ts` returns routing flags.
- `src/agents/nano.ts` answers simple requests or escalates to `moderate`.
- `src/agents/moderate.ts` orchestrates the currently exposed tools.
- `src/agents/workflow.ts` contains an in-progress workflow planner that is not wired into the current router.
- `src/agents/plugins/*` contains plugin-specialist agents for complexity, planning, coding, and review.

### Tools and Pipelines

- `src/pipelines/plugin.ts` runs new-plugin creation end to end.
- `src/tools/plugin.ts` builds plugin manifests into JARs and persists source to GitHub.
- `src/tools/google.ts` reads Google Docs through stored OAuth tokens.
- `src/tools/server/*` manages Pterodactyl access, power, files, and console websockets.
- `src/tools/sendMsgDiscord.ts` sends split Discord replies and file attachments.

### Persistence and Local State

- Prisma uses SQLite through `lib/prisma.ts`.
- Durable domain state lives in `Guild`, `Download`, `Plugin`, `Server`, `ConsoleLine`, and `GuildUser`.
- Transient state lives in process memory:
  - `clarifications[guildId]`
  - `currentlyRunning[guildId]`
  - `pterodactylWS.sockets`
  - `pterodactylWS.pendingCommands`
- Local filesystem state lives under:
  - `src/tools/downloads/<guildId>/`
  - `src/tools/pluginBuilder/<guildId>/<builderId>/`
  - `dev-logs/`

## Dependencies

- **Why this shape:** The service is built as one Node process so the Discord bot, internal setup API, in-memory clarification/concurrency state, and shared Prisma client can coordinate without a separate job system. Tool-heavy work is isolated into agents, tools, and pipelines so the router can keep the user-facing request path narrow.
- **Depends on:** Discord, OpenAI models and tool calling, Express, Prisma/SQLite, local filesystem storage, Google Docs/OAuth, Pterodactyl, GitHub, Maven, Java 17, and environment secrets.
- **Depended on by:** Discord users, trusted internal setup callers, every subsystem documented here, and operational workflows that rely on shared guild, download, plugin, server, OAuth, and console state.

## Problems, Limitations, And Notes

- The `complex` responder is referenced by `src/index.ts`, `src/router.ts`, and `src/types.ts`, but it currently returns placeholder text.
- `src/router.ts` checks `routingFlags.needs_code_execution_or_debugging_or_testing`, while the classifier schema returns `needs_iterative_code_execution_or_debugging`. That intended complex-routing flag is disconnected.
- `clarifications[guildId]` is set after a clarification, but it is not cleared after a normal follow-up.
- `moderate()` advertises OpenAI `web_search`, but the code only handles function-call outputs. If the model returns a non-function web search result without a following function call, the responder falls into the "GPT did not call a tool" error path.
- Server file tools exist in `src/tools/server/files.ts`, but `moderate()` currently exposes only `serverPower`.
- User-facing existing-plugin editing is explicitly not implemented, even though the plugin pipeline has an internal edit-plan mechanism for medium new-plugin tasks.
- Google Docs larger than about 20,000 serialized characters are rejected during pre-read; document summarization is marked TODO.
- Memory summaries and Discord slash commands are marked TODO.
- Pterodactyl websocket console command resolution depends on sentinel command output and recent console history, so it is sensitive to server output formatting and timing.
