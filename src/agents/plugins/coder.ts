import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts, pluginSchemas } from "../../prompts.js";
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
    system: pluginPrompts.sharedSystem,
    developer: developerPrompt,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.coder.high.slow,
      input: [
        { role: "system", content: pluginPrompts.sharedSystem },
        { role: "developer", content: developerPrompt },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: pluginSchemas.coderProject(request.pluginName),
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
    system: pluginPrompts.sharedSystem,
    developer: pluginPrompts.coder.editPlugin(request.pluginName),
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.coder.high.slow,
      input: [
        { role: "system", content: pluginPrompts.sharedSystem },
        { role: "developer", content: pluginPrompts.coder.editPlugin(request.pluginName) },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: pluginSchemas.coderEdit(currentProjectContext.files.map(file => file.file)),
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
