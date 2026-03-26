import { prisma } from "../../lib/prisma.js";
import { architect } from "../agents/plugins/architect.js";
import { coder } from "../agents/plugins/coder.js";
import { reviewer } from "../agents/plugins/reviewer.js";
import { router } from "../agents/plugins/router.js";
import type {
  PluginCreationRequest,
  PluginPipelineError,
  PluginPipelineResult,
  PluginProjectManifest,
  PluginReview,
  PluginTask,
} from "../agents/plugins/types.js";
import type { AgentInfo } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { plugin } from "../tools/plugin.js";

const log = createLogger("pluginPipeline");
const INITIAL_VERSION = "1.0.0";
const MAX_BUILD_FIX_ATTEMPTS = 2;

function internalError(message: string, details?: string): PluginPipelineError {
  return {
    code: "INTERNAL_ERROR",
    message,
    details,
  };
}

function formatReviewSummary(review: PluginReview) {
  const sections = [review.summary.trim()];

  if (review.commands.length) {
    sections.push(`Commands:\n${review.commands.map(command => `- ${command}`).join("\n")}`);
  }

  if (review.permissions.length) {
    sections.push(`Permissions:\n${review.permissions.map(permission => `- ${permission}`).join("\n")}`);
  }

  if (review.notes.length) {
    sections.push(`Notes:\n${review.notes.map(note => `- ${note}`).join("\n")}`);
  }

  return sections.filter(Boolean).join("\n\n");
}

function fallbackSummary(request: PluginCreationRequest, project: PluginProjectManifest) {
  const description = project.description.trim();
  if (description.length) return description;
  return request.assistantMessage.summary.trim();
}

async function savePluginRecord(
  info: AgentInfo,
  request: PluginCreationRequest,
  file: `${string}.jar`,
  summary: string,
) {
  const existingPlugin = await prisma.plugin.findFirst({
    where: {
      guildId: info.guildId,
      name: request.pluginName,
    },
  });

  if (existingPlugin) {
    await prisma.plugin.update({
      where: {
        id: existingPlugin.id,
      },
      data: {
        version: INITIAL_VERSION,
        description: summary,
        file,
      },
    });
    return;
  }

  // TO DO

  await prisma.plugin.create({
    data: {
      name: request.pluginName,
      version: INITIAL_VERSION,
      description: summary,
      file,
      guildId: info.guildId,
    },
  });
}

async function runJarBuilderWorkflow(
  info: AgentInfo,
  request: PluginCreationRequest,
  initialProject: PluginProjectManifest,
) {
  let workingProject = initialProject;

  for (let attempt = 0; attempt <= MAX_BUILD_FIX_ATTEMPTS; attempt += 1) {
    const buildResult = await plugin.buildNew(
      request.pluginName,
      INITIAL_VERSION,
      workingProject,
      info.guildId,
    );

    if (buildResult.success) {
      return {
        name: "pluginJarBuilderWorkflow",
        success: true as const,
        result: {
          artifact: buildResult.result,
          project: workingProject,
        },
      };
    }

    if (buildResult.error.code === "ALREADY_EXISTS") {
      return {
        name: "pluginJarBuilderWorkflow",
        success: false as const,
        error: {
          code: "ALREADY_EXISTS" as const,
          message: "A plugin with that name already exists.",
          details: buildResult.error.details,
        },
      };
    }

    if (buildResult.error.code !== "BUILD_FAILED" || attempt === MAX_BUILD_FIX_ATTEMPTS) {
      return {
        name: "pluginJarBuilderWorkflow",
        success: false as const,
        error: {
          code: "BUILD_FAILED" as const,
          message: "Steve could not produce a working JAR for this plugin.",
          details: buildResult.error.details,
        },
      };
    }

    const fixedProject = await coder.fixBuildError(
      info,
      request,
      workingProject,
      buildResult.error.details ?? buildResult.error.message,
    );

    if (!fixedProject.success) {
      return {
        name: "pluginJarBuilderWorkflow",
        success: false as const,
        error: internalError("The build-fix coder returned an invalid response."),
      };
    }

    workingProject = fixedProject.result;
  }

  return {
    name: "pluginJarBuilderWorkflow",
    success: false as const,
    error: {
      code: "BUILD_FAILED" as const,
      message: "Steve could not produce a working JAR for this plugin.",
    },
  };
}

async function buildProjectManifest(
  info: AgentInfo,
  request: PluginCreationRequest,
  complexityTier: "simple" | "medium",
) {
  if (complexityTier === "simple") {
    const simpleProject = await coder.createNew(info, request);
    if (simpleProject.success) {
      return {
        name: "createNewPlugin",
        success: true as const,
        result: simpleProject.result,
      };
    }

    return {
      name: "createNewPlugin",
      success: false as const,
      error: internalError("The new-plugin coder returned an invalid response."),
    };
  }

  const architecture = await architect(info, request);
  if (!architecture.success) {
    if (architecture.error.code === "IMPOSSIBLE") {
      return {
        name: "createNewPlugin",
        success: false as const,
        error: {
          code: "IMPOSSIBLE" as const,
          message: architecture.error.message,
        },
      };
    }

    return {
      name: "createNewPlugin",
      success: false as const,
      error: internalError("The architect returned an invalid response."),
    };
  }

  const [firstTask, ...remainingTasks] = architecture.result;
  const initialProject = await coder.createNew(info, request, {
    task: firstTask,
    remainingTasks,
  });

  if (!initialProject.success) {
    return {
      name: "createNewPlugin",
      success: false as const,
      error: internalError("The new-plugin coder returned an invalid response."),
    };
  }

  let workingProject = initialProject.result;
  const completedTasks: PluginTask[] = [firstTask];

  for (let index = 0; index < remainingTasks.length; index += 1) {
    const task = remainingTasks[index];
    const editResult = await coder.editExisting(info, request, {
      currentProject: workingProject,
      task,
      completedTasks,
      remainingTasks: remainingTasks.slice(index + 1),
    });

    if (!editResult.success) {
      return {
        name: "createNewPlugin",
        success: false as const,
        error: internalError("The edit-plugin coder returned an invalid response."),
      };
    }

    workingProject = editResult.result;
    completedTasks.push(task);
  }

  return {
    name: "createNewPlugin",
    success: true as const,
    result: workingProject,
  };
}

export async function createNewPlugin(
  info: AgentInfo,
  request: PluginCreationRequest,
): Promise<PluginPipelineResult> {
  log.info(`Starting plugin creation pipeline for ${request.pluginName}`);

  if (await plugin.exists(request.pluginName, info.guildId)) {
    return {
      name: "createNewPlugin",
      success: false,
      error: {
        code: "ALREADY_EXISTS",
        message: "A plugin with that name already exists.",
      },
    };
  }

  const complexity = await router(info, request);

  if (complexity.tier === "large") {
    return {
      name: "createNewPlugin",
      success: false,
      error: {
        code: "LARGE_UNSUPPORTED",
        message: "Large plugin requests are not implemented yet.",
        complexityScore: complexity.score,
        complexityTier: complexity.tier,
        details: complexity.reasoning,
      },
    };
  }

  const projectResult = await buildProjectManifest(info, request, complexity.tier);
  if (!projectResult.success) {
    return {
      name: "createNewPlugin",
      success: false,
      error: {
        ...projectResult.error,
        complexityScore: complexity.score,
        complexityTier: complexity.tier,
      },
    };
  }

  const buildResult = await runJarBuilderWorkflow(info, request, projectResult.result);
  if (!buildResult.success) {
    return {
      name: "createNewPlugin",
      success: false,
      error: {
        ...buildResult.error,
        complexityScore: complexity.score,
        complexityTier: complexity.tier,
      },
    };
  }

  const reviewResult = await reviewer(
    info,
    request,
    buildResult.result.project,
    buildResult.result.artifact,
  );
  const summary = reviewResult.success
    ? formatReviewSummary(reviewResult.result)
    : fallbackSummary(request, buildResult.result.project);

  await savePluginRecord(info, request, buildResult.result.artifact.file, summary);

  return {
    name: "createNewPlugin",
    success: true,
    result: {
      pluginName: request.pluginName,
      version: buildResult.result.artifact.version,
      file: buildResult.result.artifact.file,
      summary,
      complexityScore: complexity.score,
      complexityTier: complexity.tier,
    },
  };
}
