const dependencySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    groupId: { type: "string" },
    artifactId: { type: "string" },
    version: { type: "string" },
    scope: {
      type: "string",
      enum: ["provided", "compile", "runtime"],
    },
  },
  required: ["groupId", "artifactId", "version", "scope"],
} as const;

const repositorySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    url: { type: "string" },
  },
  required: ["id", "url"],
} as const;

const projectFileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
} as const;

const lineObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    line: { type: "integer", minimum: 1 },
    content: { type: "string" },
  },
  required: ["line", "content"],
} as const;

const lineFileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    file: { type: "string" },
    lines: {
      type: "array",
      items: lineObjectSchema,
    },
  },
  required: ["file", "lines"],
} as const;

const buildJsonSchema = (name: string, schema: Record<string, unknown>) => ({
  type: "json_schema",
  name,
  strict: true,
  schema,
}) as const;

export const pluginPrompts = {
  sharedSystem: `You are Steve, a multi-agent AI system built to assist Minecraft server owners. 
  You are specifically Steve's specialized Paper 1.20.1 Minecraft plugin agent.
Return only valid JSON that matches the provided schema.
Do not use markdown fences.
Do not explain your reasoning outside the JSON response.`,
  complexityRouter: {
    developer: `Your job is to determine the complexity of the Minecraft plugin being requested.

Classify plugin complexity as any number from 1-10, with one being a "hello world" plugin and ten being the most massive game engine or framework.

Rules:
- Do not rely on the user's idea of how complex it is. Determine complexity of the plugin yourself.
- Do not give a plugin a higher complexity because the user gives a long description of the plugin. Think about how many major systems the plugin will consist of to determine complexity.`,
  },
  architect: {
    medium: `Your job is to design a Minecraft plugin for Paper/Spigot 1.20.1 based on the user’s request.

You must break the plugin into sequential development tasks.
Each task will be implemented by a plugin coding agent.

Your goal is to produce the smallest NUMBER of clear, well-scoped development tasks needed to build the plugin step-by-step. This does NOT mean that the task itself should be small, it means that you should have a small total QUANTITY of tasks.

While you should prioritize less tasks than more, before creating a task think about this: Will a coder agent be able to code this task in one run? If no, then your task is too big and needs to be broken down into more tasks. If yes, then your task is good.




Rules: 

- If you notice that the plugin being requested is not actually reasonably possible to be created, set isPossible as 'false' and leave everything else empty.

- Each individual task should be detailed.

- Do NOT write code.
- Your job is only to design the development plan.

- Tasks must be sequential and build upon previous tasks.
- Tasks should represent major gameplay features or major implementation milestones.
- Avoid creating unnecessary or overly small tasks.


- A task should usually correspond to a meaningful feature set, not a low-level technical layer.
- Do NOT split tasks just because they involve different technical components.

- Each task may include commands, listeners, managers, storage, configuration, messages, and permissions if they belong to the same feature.
- Do NOT create separate tasks just for plugin skeleton, commands, listeners, config, notifications, or integrations unless they are large enough to be major features by themselves.

- Tasks should describe WHAT needs to be implemented, not how to set up the environment or compile the plugin.

For each task include:
- Task Name
- Description
- Extra Dependencies (if required)`,
  },
  coder: {
    newPlugin: (pluginName: string) => `Create a brand new Paper 1.20.1 plugin project for ${pluginName}.

Rules:
- Return a complete project manifest, not prose.
- The main plugin class must be named exactly ${pluginName}.
- Use package roots under com/walrusmc/${pluginName.toLowerCase()}.
- Java file paths are relative to src/main/java.
- Resource file paths are relative to src/main/resources.
- Always include plugin.yml with main: com.walrusmc.${pluginName.toLowerCase()}.${pluginName}.
- Include config/messages/resources only when useful.
- Include only the dependencies and repositories that are truly needed beyond the defaults.`,
    editPlugin: (pluginName: string) => `Update the existing in-memory Paper 1.20.1 plugin project for ${pluginName}.

Rules:
- Return only the edit plan for the current task, not the full project manifest.
- Use deletions and insertions for existing files.
- Add new files only through the new file arrays when they are actually needed.
- Preserve completed behavior unless the current task explicitly changes it.
- Keep the main plugin class named ${pluginName}.
- Existing file paths are provided as line-numbered file objects.
- Keep new Java file paths relative to src/main/java and new resource file paths relative to src/main/resources.
- Return the full dependency and repository arrays for the updated project state.`,
    fixError: (pluginName: string) => `Fix the build errors in the Paper 1.20.1 plugin project for ${pluginName}.

Rules:
- Return the full corrected project manifest.
- Fix only what is necessary to make the build succeed while preserving requested behavior.
- Keep the main plugin class named ${pluginName}.
- Do not remove requested features unless the build error makes them impossible.`,
  },
  reviewer: {
    developer: `Review the completed Paper 1.20.1 plugin project and summarize what it does.

Rules:
- Focus on user-facing behavior.
- List commands and permissions only when they actually exist.
- Keep notes concise and practical.`,
  },
} as const;

export const pluginSchemas = {
  complexityRouter: buildJsonSchema("plugin_complexity_router", {
    type: "object",
    additionalProperties: false,
    properties: {
      score: {
        type: "integer",
        minimum: 1,
        maximum: 10,
      },
      tier: {
        type: "string",
        enum: ["simple", "medium", "large"],
      },
      reasoning: {
        type: "string",
      },
    },
    required: ["score", "tier", "reasoning"],
  }),
  architect: buildJsonSchema("plugin_architecture", {
    type: "object",
    additionalProperties: false,
    properties: {
      isPossible: {
        type: "boolean",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "integer",
              minimum: 1,
              maximum: 20,
            },
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            dependencies: {
              type: "array",
              items: dependencySchema,
            },
            repositories: {
              type: "array",
              items: repositorySchema,
            },
          },
          required: ["id", "title", "description", "dependencies", "repositories"],
        },
      },
    },
    required: ["isPossible", "tasks"],
  }),
  coderProject: (pluginName: string) =>
    buildJsonSchema("plugin_project_manifest", {
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "A concise overall description of the completed plugin project.",
        },
        javaFiles: {
          type: "array",
          description: `Java files relative to src/main/java. Include the main class for ${pluginName}.`,
          items: projectFileSchema,
        },
        resourceFiles: {
          type: "array",
          description: "Resource files relative to src/main/resources. Must include plugin.yml.",
          items: projectFileSchema,
        },
        dependencies: {
          type: "array",
          items: dependencySchema,
        },
        repositories: {
          type: "array",
          items: repositorySchema,
        },
      },
      required: ["description", "javaFiles", "resourceFiles", "dependencies", "repositories"],
    }),
  coderEdit: (currentProjectFilePaths: string[]) =>
    buildJsonSchema("plugin_project_edit_plan", {
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "The updated overall project description after this task.",
        },
        deletions: {
          type: "array",
          description: "Sections of existing files to delete. Use an empty array when no deletions are needed.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              file: {
                type: "string",
                enum: currentProjectFilePaths,
              },
              startLine: {
                type: "integer",
                minimum: 1,
              },
              endLine: {
                type: "integer",
                minimum: 1,
              },
            },
            required: ["file", "startLine", "endLine"],
          },
        },
        insertions: {
          type: "array",
          description: "Sections of code to insert into existing files. Use an empty array when no insertions are needed.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              file: {
                type: "string",
                enum: currentProjectFilePaths,
              },
              startLine: {
                type: "integer",
                minimum: 0,
              },
              content: {
                type: "string",
              },
            },
            required: ["file", "startLine", "content"],
          },
        },
        newJavaFiles: {
          type: "array",
          description: "Brand new Java files relative to src/main/java.",
          items: projectFileSchema,
        },
        newResourceFiles: {
          type: "array",
          description: "Brand new resource files relative to src/main/resources.",
          items: projectFileSchema,
        },
        dependencies: {
          type: "array",
          description: "The full dependency array after this task.",
          items: dependencySchema,
        },
        repositories: {
          type: "array",
          description: "The full repository array after this task.",
          items: repositorySchema,
        },
      },
      required: [
        "description",
        "deletions",
        "insertions",
        "newJavaFiles",
        "newResourceFiles",
        "dependencies",
        "repositories",
      ],
    }),
  reviewer: buildJsonSchema("plugin_review_summary", {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
      },
      commands: {
        type: "array",
        items: {
          type: "string",
        },
      },
      permissions: {
        type: "array",
        items: {
          type: "string",
        },
      },
      notes: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["summary", "commands", "permissions", "notes"],
  }),
} as const;

export const pluginToolSchemas = {
  createNewPlugin: {
    type: "object",
    additionalProperties: false,
    properties: {
      pluginName: {
        type: "string",
        description: "The plugin name. It must also be a valid Java class name.",
      },
      assistantMessage: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: {
            type: "string",
            description: "One sentence describing the user's main intent.",
          },
          summary: {
            type: "string",
            description: "A short summary of the requested plugin behavior.",
          },
          requirements: {
            type: "array",
            description: "Concrete requirements, constraints, commands, or feature notes from the request.",
            items: {
              type: "string",
            },
          },
        },
        required: ["intent", "summary", "requirements"],
      },
    },
    required: ["pluginName", "assistantMessage"],
  },
} as const;
