# Agent: Plugin Reviewer

Source: `src/agents/plugins/reviewer.ts`

## Role

The reviewer runs only after a plugin has already built successfully.

Its job is not to judge code quality. Its job is to summarize the completed plugin in a user-facing way for:

- the final pipeline summary
- the stored `Plugin.description`

## Model

- `models.general.medium.slow`
- currently `gpt-5-mini`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Defines the plugin review/summarization role. |
| Developer prompt | Yes | `pluginPrompts.reviewer`. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Assistant prompt | Yes | JSON with `pluginRequest`, `project`, and `artifact`. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | The original Discord request context. |
| Plugin request | Yes | Structured summary of what was asked for. |
| Full project manifest | Yes | The final built project's manifest. |
| Built artifact metadata | Yes | JAR file name and version. |
| Build errors | No | Only successful builds reach the reviewer. |
| Tool history | No | None. |

## Output

Strict JSON:

- `summary`
- `commands[]`
- `permissions[]`
- `notes[]`

The pipeline flattens this into one stored summary string.

## Where the output goes

- Prisma `Plugin.description`
- final `createNewPlugin` success payload

## Failure handling

If the reviewer returns invalid JSON, the pipeline does not discard the built plugin. It falls back to a simpler summary derived from:

- `project.description`
- or the assistant-side request summary

## Design intent

The reviewer is a post-build translator from internal manifest state to a concise human-facing description. It is the last agent in the current plugin workflow.
