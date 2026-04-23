# AgentSteve Docs

This directory documents the current `AgentSteve` codebase as it exists in `WalrusMC/AgentSteve`.

The fastest way to understand the system is:

1. Read [architecture/overview.md](architecture/overview.md).
2. Read [workflows/message-routing.md](workflows/message-routing.md).
3. Read [architecture/plugin.md](architecture/plugin.md) and [workflows/plugin-creation.md](workflows/plugin-creation.md).
4. Use the files in [agents/](agents/) as reference sheets for each agent.

## Docs map

- [architecture/overview.md](architecture/overview.md): Top-level runtime map, data model, external systems, and current gaps.
- [architecture/plugin.md](architecture/plugin.md): The plugin-generation subsystem, its agent chain, and its build/persistence flow.
- [workflows/message-routing.md](workflows/message-routing.md): What happens when a Discord admin mentions Steve.
- [workflows/plugin-creation.md](workflows/plugin-creation.md): End-to-end plugin creation flow from `moderate()` to JAR delivery.
- [workflows/google-docs.md](workflows/google-docs.md): Google OAuth, token storage, and document-reading flow.
- [workflows/server-access.md](workflows/server-access.md): Server enrollment, power actions, file operations, and websocket behavior.

## Agent reference files

- [agents/classifier.md](agents/classifier.md)
- [agents/nano.md](agents/nano.md)
- [agents/moderate.md](agents/moderate.md)
- [agents/complex.md](agents/complex.md)
- [agents/plugin-router.md](agents/plugin-router.md)
- [agents/architect.md](agents/architect.md)
- [agents/coder.md](agents/coder.md)
- [agents/reviewer.md](agents/reviewer.md)

## Scope of these docs

These docs describe:

- The actual runtime and file layout in this repository.
- Which agents exist, what inputs they receive, and what they can output.
- How Discord, Prisma, Google Docs, GitHub, and Pterodactyl fit together.
- Which areas are placeholders, partially wired, or TODO-backed.

These docs do not assume intended future behavior unless the code already references it directly.
