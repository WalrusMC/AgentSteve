import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts, pluginSchemas } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type {
  PluginCoderResult,
  PluginCreationRequest,
  PluginProjectManifest,
  PluginTask,
} from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginCoder");

type CreateNewOptions = {
  task?: PluginTask;
  remainingTasks?: PluginTask[];
};

type EditOptions = {
  currentProject: PluginProjectManifest;
  task: PluginTask;
  completedTasks: PluginTask[];
  remainingTasks: PluginTask[];
};

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

export const coder = {
  createNew(
    info: AgentInfo,
    request: PluginCreationRequest,
    options: CreateNewOptions = {},
  ) {
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
    return generateProjectManifest(
      info,
      request,
      pluginPrompts.coder.editPlugin(request.pluginName),
      {
        workflow: {
          mode: "medium",
          completedTasks: options.completedTasks,
          currentTask: options.task,
          remainingTasks: options.remainingTasks,
        },
        currentProject: options.currentProject,
      },
      "pluginCoder.editExisting",
    );
  },

  fixBuildError(
    info: AgentInfo,
    request: PluginCreationRequest,
    currentProject: PluginProjectManifest,
    buildError: string,
  ) {
    return generateProjectManifest(
      info,
      request,
      pluginPrompts.coder.fixError(request.pluginName),
      {
        currentProject,
        buildError,
      },
      "pluginCoder.fixBuildError",
    );
  },
};
