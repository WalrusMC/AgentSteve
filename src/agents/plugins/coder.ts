import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type {
  PluginCoderResult,
  PluginCreationRequest,
  PluginEditCoderResult,
  PluginEditPlan,
  PluginLineObject,
  PluginProjectFileLines,
  PluginProjectManifest,
  PluginTask,
} from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginCoder");
const JAVA_ROOT = "src/main/java";
const RESOURCE_ROOT = "src/main/resources";
const systemPrompt = `You are Steve, a multi-agent system built to assist Minecraft server owners.
You are specifically the plugin coding specialist agent, part of Steve, a multi-agent system.
You implement Paper 1.20.1 plugin tasks.
Return only valid JSON that matches the provided schema.
Do not use markdown fences.
Do not explain your reasoning outside the JSON response.`;

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

const buildJsonSchema = (name: string, schema: Record<string, unknown>) =>
  ({
    type: "json_schema",
    name,
    strict: true,
    schema,
  }) as const;

const coderProjectSchema = (pluginName: string) =>
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
  });

const coderEditSchema = (currentProjectFilePaths: string[]) =>
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
  });

// New-plugin generation can optionally be scoped to the first architect task for medium flows.
type CreateNewOptions = {
  task?: PluginTask;
  remainingTasks?: PluginTask[];
};

// Edit-plugin generation works against the current in-memory project plus task history.
type EditOptions = {
  currentProject: PluginProjectManifest;
  task: PluginTask;
  completedTasks: PluginTask[];
  remainingTasks: PluginTask[];
};

// Existing project files are passed to edit coders as numbered lines so they can return
// targeted insertions/deletions instead of rewriting entire files.
function toLineObjects(content: string): PluginLineObject[] {
  return content.split("\n").map((line, index) => ({
    line: index + 1,
    content: line,
  }));
}

// The model needs fully-qualified project paths so its edit plan can target the exact file.
function projectToLineObjects(project: PluginProjectManifest): PluginProjectFileLines[] {
  return [
    ...project.javaFiles.map(file => ({
      file: `${JAVA_ROOT}/${file.path}`,
      lines: toLineObjects(file.content),
    })),
    ...project.resourceFiles.map(file => ({
      file: `${RESOURCE_ROOT}/${file.path}`,
      lines: toLineObjects(file.content),
    })),
  ];
}

// This is the shared "current project" shape used by edit and fix-error coders.
function buildCurrentProjectContext(project: PluginProjectManifest) {
  return {
    description: project.description,
    files: projectToLineObjects(project),
    dependencies: project.dependencies,
    repositories: project.repositories,
  };
}

// New-plugin and fix-error coders both return a full manifest for the next pipeline step.
async function generateProjectManifest(
  info: AgentInfo,
  request: PluginCreationRequest,
  developerPrompt: string,
  assistantContext: Record<string, unknown>,
  name: string,
): Promise<PluginCoderResult> {
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request, assistantContext);

  log.response(`OPENAI INPUT (${name})`, {
    system: systemPrompt,
    developer: developerPrompt,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.coder.high.slow,
      input: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: developerPrompt },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: coderProjectSchema(request.pluginName),
      },
    });

    return {
      name,
      success: true,
      result: JSON.parse(response.output_text) as PluginProjectManifest,
    };
  } catch (error) {
    log.error(`${name} failed:`, error);
    return {
      name,
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The coder returned an invalid project manifest.",
      },
    };
  }
}

// The edit coder returns a compact patch plan against the current project state.
async function generateEditPlan(
  info: AgentInfo,
  request: PluginCreationRequest,
  options: EditOptions,
): Promise<PluginEditCoderResult> {
  const name = "pluginCoder.editExisting";
  const userInput = buildPluginUserInput(info);
  const currentProjectContext = buildCurrentProjectContext(options.currentProject);
  const assistantInput = buildPluginAssistantInput(request, {
    workflow: {
      mode: "medium",
      completedTasks: options.completedTasks,
      currentTask: options.task,
      remainingTasks: options.remainingTasks,
    },
    currentProject: currentProjectContext,
  });

  log.response(`OPENAI INPUT (${name})`, {
    system: systemPrompt,
    developer: pluginPrompts.coder.editPlugin(request.pluginName),
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.coder.high.slow,
      input: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: pluginPrompts.coder.editPlugin(request.pluginName) },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: coderEditSchema(currentProjectContext.files.map(file => file.file)),
      },
    });

    return {
      name,
      success: true,
      result: JSON.parse(response.output_text) as PluginEditPlan,
    };
  } catch (error) {
    log.error(`${name} failed:`, error);
    return {
      name,
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The edit coder returned an invalid edit plan.",
      },
    };
  }
}

export const coder = {
  createNew(
    info: AgentInfo,
    request: PluginCreationRequest,
    options: CreateNewOptions = {},
  ) {
    // In the medium workflow this creates the initial project from the first architect task.
    return generateProjectManifest(
      info,
      request,
      pluginPrompts.coder.newPlugin(request.pluginName),
      {
        workflow: {
          mode: options.task ? "medium" : "simple",
          currentTask: options.task ?? null,
          remainingTasks: options.remainingTasks ?? [],
        },
      },
      "pluginCoder.createNew",
    );
  },

  editExisting(
    info: AgentInfo,
    request: PluginCreationRequest,
    options: EditOptions,
  ) {
    // Later medium-workflow tasks edit the current project incrementally.
    return generateEditPlan(info, request, options);
  },

  fixBuildError(
    info: AgentInfo,
    request: PluginCreationRequest,
    currentProject: PluginProjectManifest,
    buildError: string,
  ) {
    // Build repairs still return a full manifest because the pipeline replaces the
    // broken project state with a corrected one before rebuilding.
    return generateProjectManifest(
      info,
      request,
      pluginPrompts.coder.fixError(request.pluginName),
      {
        currentProject: buildCurrentProjectContext(currentProject),
        buildError,
      },
      "pluginCoder.fixBuildError",
    );
  },
};
