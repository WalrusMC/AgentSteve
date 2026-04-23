# Agent: Plugin Architect

Source: `src/agents/plugins/architect.ts`

## Role

The architect designs a sequential implementation plan for medium-complexity plugins.

It turns one plugin request into ordered `PluginTask[]` that the coder can execute step by step.

## Model

- `models.general.high.slow`
- currently `gpt-5.4`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Defines the plugin architecture planning role. |
| Developer prompt | Yes | `pluginPrompts.architect.medium`. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Assistant prompt | Yes | JSON containing `pluginRequest`. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | Time, author, content, attachments. |
| Plugin request | Yes | `pluginName`, intent, summary, requirements. |
| Existing code/project files | No | The architect never sees generated code. |
| Completed tasks | No | It creates the first task list, so no history exists yet. |
| Build errors | No | None. |

## Output

Strict JSON:

- `isPossible`
- `tasks[]`

Each task contains:

- `id`
- `title`
- `description`
- `dependencies[]`
- `repositories[]`

The runtime sorts tasks by `id` before using them.

## Failure behavior

The architect returns:

- `IMPOSSIBLE` if the request is not feasible in the current workflow
- `INVALID_RESPONSE` if parsing fails or no tasks are returned

## What happens next

If the architect succeeds:

- the first task is passed to `coder.createNew()`
- later tasks are passed one by one to `coder.editExisting()`

## Design intent

The prompt pushes the architect toward:

- a small number of meaningful tasks
- sequential feature-level milestones
- no code
- no environment/setup busywork

This agent is the planning bridge between a user request and the incremental medium-plugin build flow.
