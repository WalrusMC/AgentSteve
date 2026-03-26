import type { ToolResult } from "../../types.js";

export type PluginComplexityTier = "simple" | "medium" | "large";
export type MavenDependencyScope = "provided" | "compile" | "runtime";

export type MavenDependency = {
  groupId: string;
  artifactId: string;
  version: string;
  scope: MavenDependencyScope;
};

export type MavenRepository = {
  id: string;
  url: string;
};

export type PluginProjectFile = {
  path: string;
  content: string;
};

export type PluginProjectManifest = {
  description: string;
  javaFiles: PluginProjectFile[];
  resourceFiles: PluginProjectFile[];
  dependencies: MavenDependency[];
  repositories: MavenRepository[];
};

export type PluginTask = {
  id: number;
  title: string;
  description: string;
  dependencies: MavenDependency[];
  repositories: MavenRepository[];
};

export type PluginRequestMessage = {
  intent: string;
  summary: string;
  requirements: string[];
};

export type PluginCreationRequest = {
  pluginName: string;
  assistantMessage: PluginRequestMessage;
};

export type PluginComplexityDecision = {
  score: number;
  tier: PluginComplexityTier;
  reasoning: string;
};

export type PluginReview = {
  summary: string;
  commands: string[];
  permissions: string[];
  notes: string[];
};

export type BuiltPluginArtifact = {
  file: `${string}.jar`;
  version: string;
};

export type PluginPipelineSuccess = {
  pluginName: string;
  version: string;
  file: `${string}.jar`;
  summary: string;
  complexityScore: number;
  complexityTier: PluginComplexityTier;
};

export type PluginPipelineErrorCode =
  | "ALREADY_EXISTS"
  | "IMPOSSIBLE"
  | "LARGE_UNSUPPORTED"
  | "BUILD_FAILED"
  | "INTERNAL_ERROR";

export type PluginPipelineError = {
  code: PluginPipelineErrorCode;
  message: string;
  complexityScore?: number;
  complexityTier?: PluginComplexityTier;
  details?: string;
};

export type PluginPipelineResult = ToolResult<PluginPipelineSuccess, PluginPipelineError>;

export type PluginBuildErrorCode = "ALREADY_EXISTS" | "BUILD_FAILED" | "GITHUB_FAILED";

export type PluginBuildError = {
  code: PluginBuildErrorCode;
  message: string;
  details?: string;
};

export type PluginBuildResult = ToolResult<BuiltPluginArtifact, PluginBuildError>;

export type PluginArchitectResult = ToolResult<
  PluginTask[],
  {
    code: "IMPOSSIBLE" | "INVALID_RESPONSE";
    message: string;
  }
>;

export type PluginCoderResult = ToolResult<
  PluginProjectManifest,
  {
    code: "INVALID_RESPONSE";
    message: string;
  }
>;

export type PluginReviewerResult = ToolResult<
  PluginReview,
  {
    code: "INVALID_RESPONSE";
    message: string;
  }
>;
