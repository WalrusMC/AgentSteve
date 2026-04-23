import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../../lib/prisma.js";
import type {
  MavenDependency,
  MavenRepository,
  PluginBuildResult,
  PluginProjectFile,
  PluginProjectManifest,
} from "../agents/plugins/types.js";
import { createLogger } from "../utils/logger.js";
import { github } from "../utils/github.js";

type PluginTool = {
  exists(pluginName: string, guildId: string): Promise<boolean>;
  buildNew(
    pluginName: string,
    version: string,
    project: PluginProjectManifest,
    guildId: string,
  ): Promise<PluginBuildResult>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createLogger("plugin");

const DEFAULT_REPOSITORIES: MavenRepository[] = [
  {
    id: "papermc-repo",
    url: "https://repo.papermc.io/repository/maven-public/",
  },
  {
    id: "sonatype",
    url: "https://oss.sonatype.org/content/groups/public/",
  },
];

const DEFAULT_DEPENDENCIES: MavenDependency[] = [
  {
    groupId: "io.papermc.paper",
    artifactId: "paper-api",
    version: "1.20.1-R0.1-SNAPSHOT",
    scope: "provided",
  },
  {
    groupId: "net.kyori",
    artifactId: "adventure-api",
    version: "4.14.0",
    scope: "compile",
  },
];

export const plugin: PluginTool = {} as PluginTool;

function appendCapped(existing: string, chunk: Buffer, cap: number) {
  const next = `${existing}${chunk.toString("utf8")}`;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function normalizeProjectPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.length) throw new Error("Project file paths cannot be empty.");
  if (normalized.startsWith("..") || normalized.includes("/../") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Invalid project file path: ${filePath}`);
  }
  return normalized;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function renderPomXml(
  pluginName: string,
  version: string,
  repositories: MavenRepository[],
  dependencies: MavenDependency[],
) {
  const repositoryXml = repositories
    .map(
      repository => `        <repository>
            <id>${repository.id}</id>
            <url>${repository.url}</url>
        </repository>`,
    )
    .join("\n");

  const dependencyXml = dependencies
    .map(
      dependency => `        <dependency>
            <groupId>${dependency.groupId}</groupId>
            <artifactId>${dependency.artifactId}</artifactId>
            <version>${dependency.version}</version>
            <scope>${dependency.scope}</scope>
        </dependency>`,
    )
    .join("\n");

  return `<project xmlns="http://maven.apache.org/POM/4.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.walrusmc</groupId>
    <artifactId>${pluginName}</artifactId>
    <version>${version}</version>
    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <repositories>
${repositoryXml}
    </repositories>

    <dependencies>
${dependencyXml}
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>17</source>
                    <target>17</target>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

async function writeProjectFiles(
  rootDir: string,
  files: PluginProjectFile[],
) {
  const writtenPaths = new Set<string>();

  for (const file of files) {
    const normalizedPath = normalizeProjectPath(file.path);
    if (writtenPaths.has(normalizedPath)) {
      throw new Error(`Duplicate project file path: ${normalizedPath}`);
    }

    writtenPaths.add(normalizedPath);
    const targetPath = path.join(rootDir, ...normalizedPath.split("/"));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
  }
}

async function runMavenBuild(cwd: string) {
  const outputCap = 2_000_000;

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("mvn", ["-f", "pom.xml", "-B", "clean", "package"], {
      cwd,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout = appendCapped(stdout, data, outputCap);
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr = appendCapped(stderr, data, outputCap);
    });

    child.on("error", err => reject(err));
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject({
        code,
        stdout,
        stderr,
      });
    });
  });
}

function getBuildErrorText(error: unknown) {
  const maybeObject = error as {
    stdout?: string;
    stderr?: string;
    message?: string;
  };

  return [maybeObject?.stderr, maybeObject?.stdout, maybeObject?.message]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function validateProject(pluginName: string, project: PluginProjectManifest) {
  if (!project.javaFiles.length) {
    throw new Error(`The generated project for ${pluginName} did not include any Java files.`);
  }

  const pluginYml = project.resourceFiles.find(file => normalizeProjectPath(file.path) === "plugin.yml");
  if (!pluginYml) {
    throw new Error(`The generated project for ${pluginName} must include plugin.yml.`);
  }

  const expectedMain = `main: com.walrusmc.${pluginName.toLowerCase()}.${pluginName}`;
  if (!pluginYml.content.includes(expectedMain)) {
    throw new Error(`plugin.yml must contain "${expectedMain}".`);
  }
}

function getBuiltJarName(files: string[]) {
  return files.find(file => file.endsWith(".jar") && !file.includes("-sources") && !file.includes("-javadoc"));
}

async function persistSourceToGithub(
  pluginName: string,
  guildId: string,
  project: PluginProjectManifest,
  pomXml: string,
) {
  const created = await github.createRepo(pluginName, guildId);
  if (!created) {
    throw new Error(`A source repository for ${pluginName} already exists.`);
  }

  for (const file of project.javaFiles) {
    const normalizedPath = normalizeProjectPath(file.path);
    await github.writeFile(
      pluginName,
      `src/main/java/${normalizedPath}`,
      file.content,
      `Add ${normalizedPath}`,
      guildId,
    );
  }

  for (const file of project.resourceFiles) {
    const normalizedPath = normalizeProjectPath(file.path);
    await github.writeFile(
      pluginName,
      `src/main/resources/${normalizedPath}`,
      file.content,
      `Add ${normalizedPath}`,
      guildId,
    );
  }

  await github.writeFile(pluginName, "pom.xml", pomXml, "Add pom.xml", guildId);
}

plugin.exists = async function exists(pluginName, guildId) {
  const existingPlugin = await prisma.plugin.findFirst({
    where: {
      guildId,
      name: pluginName,
    },
  });

  if (existingPlugin) return true;

  try {
    const repos = await github.listRepos(guildId);
    return repos.includes(pluginName);
  } catch (error) {
    log.warn("Failed to check GitHub repo existence, continuing with DB-only check:", error);
    return false;
  }
};

plugin.buildNew = async function buildNew(pluginName, version, project, guildId) {
  const builderId = `${pluginName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const builderRoot = path.join(__dirname, "pluginBuilder", guildId, builderId);
  const javaRoot = path.join(builderRoot, "src", "main", "java");
  const resourcesRoot = path.join(builderRoot, "src", "main", "resources");
  const downloadsRoot = path.join(__dirname, "downloads", guildId);
  const jarOutputName: `${string}.jar` = `${pluginName}-${version}.jar`;

  try {
    validateProject(pluginName, project);

    const repositories = uniqueBy(
      [...DEFAULT_REPOSITORIES, ...project.repositories],
      repository => `${repository.id}|${repository.url}`,
    );
    const dependencies = uniqueBy(
      [...DEFAULT_DEPENDENCIES, ...project.dependencies],
      dependency =>
        `${dependency.groupId}|${dependency.artifactId}|${dependency.version}|${dependency.scope}`,
    );
    const pomXml = renderPomXml(pluginName, version, repositories, dependencies);

    await fs.rm(builderRoot, { recursive: true, force: true });
    await fs.mkdir(javaRoot, { recursive: true });
    await fs.mkdir(resourcesRoot, { recursive: true });
    await fs.mkdir(downloadsRoot, { recursive: true });

    await writeProjectFiles(javaRoot, project.javaFiles);
    await writeProjectFiles(resourcesRoot, project.resourceFiles);
    await fs.writeFile(path.join(builderRoot, "pom.xml"), pomXml, "utf8");

    log.info(`Building plugin ${pluginName}-${version}.jar`);
    await runMavenBuild(builderRoot);

    const targetDir = path.join(builderRoot, "target");
    const builtFiles = await fs.readdir(targetDir);
    const builtJarName = getBuiltJarName(builtFiles);

    if (!builtJarName) {
      throw new Error("Maven completed without producing a JAR.");
    }

    const finalJarPath = path.join(downloadsRoot, jarOutputName);
    await fs.rm(finalJarPath, { force: true });
    await fs.rename(path.join(targetDir, builtJarName), finalJarPath);

    const existingDownload = await prisma.download.findFirst({
      where: {
        guildId,
        file: jarOutputName,
      },
    });

    if (existingDownload) {
      await prisma.download.update({
        where: {
          id: existingDownload.id,
        },
        data: {
          description: "A Minecraft plugin JAR created by Steve.",
        },
      });
    } else {
      await prisma.download.create({
        data: {
          file: jarOutputName,
          description: "A Minecraft plugin JAR created by Steve.",
          guildId,
        },
      });
    }

    try {
      await persistSourceToGithub(pluginName, guildId, project, pomXml);
    } catch (error) {
      return {
        name: "plugin.buildNew",
        success: false,
        error: {
          code: getBuildErrorText(error).includes("already exists") ? "ALREADY_EXISTS" : "GITHUB_FAILED",
          message: "The plugin built successfully, but Steve could not persist the source repository.",
          details: getBuildErrorText(error),
        },
      };
    }

    return {
      name: "plugin.buildNew",
      success: true,
      result: {
        file: jarOutputName,
        version,
      },
    };
  } catch (error) {
    const errorText = getBuildErrorText(error);
    log.error("Plugin build failed:", errorText || error);

    return {
      name: "plugin.buildNew",
      success: false,
      error: {
        code: "BUILD_FAILED",
        message: "The plugin failed to build into a JAR.",
        details: errorText || "Unknown build failure.",
      },
    };
  } finally {
    await fs.rm(builderRoot, { recursive: true, force: true }).catch(() => {});
  }
};
