# Agent: Plugin Complexity Router

Source: `src/agents/plugins/router.ts`

## Role

This agent decides how large a requested plugin is before any plugin generation begins.

It is not the top-level Discord router. It is the plugin-specific complexity router used only inside `src/pipelines/plugin.ts`.

## Model

- `models.general.high.slow`
- currently `gpt-5.4`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Defines the plugin complexity routing specialist role. |
| Developer prompt | Yes | `pluginPrompts.complexityRouter`. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Assistant prompt | Yes | JSON containing `pluginRequest`. |
| Past chats | Yes | Same normalized Discord history used by the other plugin specialists. |
| Current user message | Yes | Current message data from Discord. |
| Plugin request | Yes | `pluginName` plus assistant-generated request summary and requirements. |
| Code/project files | No | It does not see any project files. |
| Task plan | No | None yet. |
| Build errors | No | None. |

## Output

Strict JSON:

- `score` from `1` to `10`
- `tier` as `simple`, `medium`, or `large`
- `reasoning`

The pipeline then clamps the score and recomputes the tier from the score:

- `1-4` -> `simple`
- `5-7` -> `medium`
- `8-10` -> `large`

## How it affects the workflow

- `simple` -> one-pass coder flow
- `medium` -> architect plus incremental coder flow
- `large` -> immediate rejection as unsupported

## What it does not do

- no code generation
- no planning tasks
- no tool calls
- no persistence
