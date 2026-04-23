# Agent: Plugin Coder

Source: `src/agents/plugins/coder.ts`

## Role

The plugin coder is the implementation specialist. It has three modes:

- `createNew`
- `editExisting`
- `fixBuildError`

This is the only agent that directly emits plugin project structure and source content.

## Model

- `models.coder.high.slow`
- currently `gpt-5.3-codex`

## Shared inputs across all modes

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Defines the plugin coding specialist role. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | Time, author, content, attachments. |
| Plugin request | Yes | Always included inside the assistant prompt. |
| Existing code/project files | Sometimes | Depends on mode. |
| Workflow task context | Sometimes | Depends on mode. |
| Build errors | Sometimes | Depends on mode. |
| Tool history | No | None. |
| External resources inventory | No | No downloads, servers, or plugin DB view. |

## Mode: `createNew`

Developer prompt:

- `pluginPrompts.coder.newPlugin(pluginName)`

Assistant input includes:

- `pluginRequest`
- `workflow.mode`
- optional `currentTask`
- optional `remainingTasks`

### What it sees

- The original request context
- The plugin name and assistant summary
- For medium plugins, the first planned task and the remaining tasks

### What it returns

A full `PluginProjectManifest`:

- `description`
- `javaFiles[]`
- `resourceFiles[]`
- `dependencies[]`
- `repositories[]`

## Mode: `editExisting`

Developer prompt:

- `pluginPrompts.coder.editPlugin(pluginName)`

Assistant input includes:

- `pluginRequest`
- `workflow.mode = "medium"`
- `completedTasks`
- `currentTask`
- `remainingTasks`
- `currentProject`

`currentProject.files[]` are line-numbered and use fully qualified project paths like:

- `src/main/java/...`
- `src/main/resources/...`

### What it sees

- the original request
- the current state of the generated project
- task history
- the exact task to implement next

### What it returns

A `PluginEditPlan`:

- `deletions[]`
- `insertions[]`
- `newJavaFiles[]`
- `newResourceFiles[]`
- replacement `dependencies[]`
- replacement `repositories[]`

The pipeline applies this edit plan locally.

## Mode: `fixBuildError`

Developer prompt:

- `pluginPrompts.coder.fixError(pluginName)`

Assistant input includes:

- `pluginRequest`
- `currentProject`
- `buildError`

### What it sees

- the current full manifest
- line-numbered files
- dependency and repository state
- raw Maven error output

### What it returns

Another full `PluginProjectManifest` that replaces the broken one before the next build attempt.

## What the coder does not do

- It does not run Maven.
- It does not write files to disk itself.
- It does not talk to GitHub directly.
- It does not persist anything to Prisma.

Those responsibilities stay in deterministic TypeScript code.

## Why this agent matters

The plugin coder is the main source-code generator in the system. The rest of the plugin subsystem exists to:

- decide when to call it
- constrain the form of its output
- validate and apply that output
- compile and persist the result
