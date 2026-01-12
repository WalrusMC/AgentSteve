import { spawn } from "child_process";
import fs from "fs/promises";
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from "../utils/logger.js";
import { github } from "../utils/github.js";
import { prisma } from "../../lib/prisma.js";

import type { ToolResult } from "../types.ts";

// Types & Interfaces
interface Plugin {
  createNew(
    pluginName: string,
    pluginDescription: string,
    pluginJava: string,
    pluginYML: string,
    configYML?: string,
    dependencies?: string[],
    guildId?: string,
  ): Promise<ToolResult<PluginDB, { information: string; code: PluginCodes }>>;
  edit(
    pluginName: string,
    pluginDescription: string,
    deletions: CodeDeletion[],
    insertions: CodeInsertion[],
    addDependencies: string[],
    removeDependencies: Array<string | number>,
    guildId?: string,
  ): Promise<ToolResult<PluginDB, { information: string, code: PluginCodes } | string>>;
  retrieveCode(
    pluginName: string, 
    files: string[], 
    guildId: string
  ): Promise<ToolResult<{ name: string, description: string, code: CodeLines }, string>>;
};
type CodeLine = {
  line: number,
  text: string
};
type Dependency = {
  dependency: number,
  block: string
};
type CodeLines = {
  pluginJava?: CodeLine[],
  pluginYML?: CodeLine[],
  configYML?: CodeLine[],
  dependencies?: Dependency[]
};
type CodeStrings = {
  pluginJava?: string,
  pluginYML?: string,
  configYML?: string,
  dependencies?: Dependency[]
};
type PluginCodes = "CRASH" | "ALREADY_EXISTS" | "UNKOWN";
export type PluginDB = {
  name: string,
  version: string,
  description: string,
  file: `${string}.jar`
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createLogger("plugin");

export const plugin: Plugin = {} as Plugin;

const bumpPatchVersion = (version: string = "1.0.0") => {
  const parts = `${version}`.split(".").map(part => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return parts.join(".");
};

/**
 * Apply the requested deletions/insertions to a text file.
 */
type CodeDeletion = { file: string; startLine: number | string; endLine: number | string };
type CodeInsertion = { file: string; startLine: number | string; content: string };

const applyTextChanges = (
  content: string,
  fileKey: string,
  deletions: CodeDeletion[] = [],
  insertions: CodeInsertion[] = [],
) => {
  if (!content?.length) return content;
  const lines = content.split("\n");

  deletions
    .filter(entry => entry?.file === fileKey)
    .sort((a, b) => (Number.parseInt(String(b.startLine), 10) || 0) - (Number.parseInt(String(a.startLine), 10) || 0))
    .forEach(({ startLine, endLine }) => {
      const startLineValue = Number.parseInt(String(startLine), 10) || 1;
      const endLineValueRaw = Number.parseInt(String(endLine), 10);
      const endLineValue = Number.isFinite(endLineValueRaw) ? Math.max(startLineValue, endLineValueRaw) : startLineValue;
      const startIdx = Math.max(0, startLineValue - 1);
      const deleteCount = Math.max(0, endLineValue - startLineValue + 1);
      lines.splice(startIdx, deleteCount);
    });

  insertions
    .filter(entry => entry?.file === fileKey)
    .sort((a, b) => (Number.parseInt(String(a.startLine), 10) || 0) - (Number.parseInt(String(b.startLine), 10) || 0))
    .forEach(({ startLine, content: insertionContent }) => {
      if (typeof insertionContent !== "string") return;
      const insertionLineValue = Number.parseInt(String(startLine), 10);
      const insertionIdx = Math.max(0, Math.min(lines.length, Number.isFinite(insertionLineValue) ? insertionLineValue : 0));
      const insertionLines = insertionContent.split("\n");
      lines.splice(insertionIdx, 0, ...insertionLines);
    });

  return lines.join("\n");
};

const appendCapped = (existing: string, chunk: Buffer, cap: number) => {
  const next = existing + chunk.toString("utf8");
  return next.length > cap ? next.slice(next.length - cap) : next;
};

const runMavenBuild = async (cwd: string) => {
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

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject({ code, stdout, stderr });
    });
  });
};

// Converts strings to arrays of lines.
function codeStringsToLines(code: CodeStrings): CodeLines {

  const returnCode: CodeLines = {};

  returnCode.dependencies = [ 
    {
      dependency: 1, 
      block: `<dependency>
      <groupId>io.papermc.paper</groupId>
      <artifactId>paper-api</artifactId>
      <version>1.20.1-R0.1-SNAPSHOT</version>
      <scope>provided</scope>
    </dependency>`
    }, 
    {
      dependency: 2,
      block: `
      <dependency>
        <groupId>net.kyori</groupId>
        <artifactId>adventure-api</artifactId>
        <version>4.14.0</version>
      </dependency>`
    },
  ];

  // Add line numbers to files
  if (code?.pluginJava) {
    let counter = 0;
    const lines = [];
    for (const line of code.pluginJava.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    returnCode.pluginJava = lines;
  }

  if (code?.pluginYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.pluginYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    returnCode.pluginYML = lines;
  }

  if (code?.configYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.configYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    returnCode.configYML = lines;
  }

  if (code.dependencies?.length) {
    let counter = 2;
    const blocks: Array<{ dependency: number; block: string }> = [];
    for (const dependency of code.dependencies) {
      blocks.push( { dependency: counter, block: dependency.block } );
      counter++;
    }
    returnCode.dependencies.push(... blocks);
  }

  return returnCode;
}

/**
 * {
 *  success: true/false
 *  file: undefined/filename
 *  error: undefined/errorreport
 * }
 */
async function buildJAR(
  pluginName: string,
  pluginVersion: string,
  pluginJava: string,
  pluginYML: string,
  configYML: string,
  pomXML: string,
  guildId: string,
  dependencies: string[] = [],
): Promise<ToolResult<`${string}.jar`, { information: string, code: PluginCodes }>> {
  const dependenciesArray = [ 
    {
      dependency: 1, 
      block: `
      <dependency>
        <groupId>io.papermc.paper</groupId>
        <artifactId>paper-api</artifactId>
        <version>1.20.1-R0.1-SNAPSHOT</version>
        <scope>provided</scope>
      </dependency>`
    }, 
    {
      dependency: 2,
      block: `
      <dependency>
        <groupId>net.kyori</groupId>
        <artifactId>adventure-api</artifactId>
        <version>4.14.0</version>
      </dependency>`
    },
  ];

  if (dependencies?.length) {
    let counter = 2;
    let lines = [];
    for (const dependency of dependencies) {
      lines.push( { dependency: counter, block: dependency } );
      counter++;
    }
    dependenciesArray.push(... lines);
  };

// Generate temp build directory structure and build the jar
  const builderRoot = path.join(__dirname, "pluginBuilder", guildId);
  const javaDir = path.join(builderRoot, "src", "main", "java", "com", "walrusmc");
  const resourcesDir = path.join(builderRoot, "src", "main", "resources");
  const pomPath = path.join(builderRoot, "pom.xml");
  const storedGuildDir = path.join(__dirname, "downloads", guildId);
  const jarOutputName: `${string}.jar` = `${pluginName}-${pluginVersion}.jar`;

  try {
    await fs.rm(builderRoot, { recursive: true, force: true });
    await fs.mkdir(javaDir, { recursive: true });
    await fs.mkdir(resourcesDir, { recursive: true });
    await fs.mkdir(storedGuildDir, { recursive: true });

    await fs.writeFile(path.join(javaDir, `${pluginName}.java`), pluginJava);
    await fs.writeFile(path.join(resourcesDir, "config.yml"), configYML);
    await fs.writeFile(path.join(resourcesDir, "plugin.yml"), pluginYML);
    await fs.writeFile(pomPath, pomXML);

    log.info(`Building plugin ${pluginName}-${pluginVersion}.jar`);
    await runMavenBuild(builderRoot);

    const targetDir = path.join(builderRoot, "target");
    const files = await fs.readdir(targetDir);
    const builtJar = files.find(file => file.endsWith(".jar"));

    if (!builtJar) {
      throw new Error("Maven build completed but no JAR was produced.");
    }

    await fs.rename(path.join(targetDir, builtJar), path.join(storedGuildDir, jarOutputName));

    log.info(`Built plugin JAR: ${jarOutputName}`);
    return { 
      name: "buildJAR",
      success: true,
      result: jarOutputName
    };
  } catch (err: unknown) {
    const error = err as any;
    log.error("Maven build failed:", error?.stderr || error?.stdout || error?.message || error);
    return {
      name: "buildJAR",
      success: false,
      error: {
        code: "CRASH",
        information: JSON.stringify({
          error: error?.stderr || error?.stdout || error?.message,
          pluginName: pluginName,
          version: pluginVersion,
          code: codeStringsToLines({
            pluginJava,
            pluginYML,
            configYML,
            dependencies: dependenciesArray
          })
        }, null, 2),
      },
    };
  } finally {
    await fs.rm(builderRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Creates a new plugin and returns file name as result
 */
plugin.createNew = async function(
  pluginName,
  pluginDescription,
  pluginJava,
  pluginYML,
  configYML = "# No config right now",
  dependencies = [],
  guildId?,
) {
  if (!guildId) throw new Error("Missing guildId for plugin.createNew()");
  if (!configYML?.length) configYML = "# No config right now";

  // Create GitHub Repo
  log.debug("Creating repo on github.");
  if (!await github.createRepo(pluginName, guildId)) return { name: "plugin.createNew", success: false, error: { information: "You tried to create a new plugin, but a plugin with that name already exists!", code: "ALREADY_EXISTS" } };

  // Create dependency string
  // Keep dependencies as structured XML blocks so edits can add/remove them later.
  const dependencyBlocks = Array.isArray(dependencies) ? [...dependencies] : [];
  const fullDependencies = dependencyBlocks.join("\n\n");

  const pomXML = `
  <project xmlns="http://maven.apache.org/POM/4.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">

      <modelVersion>4.0.0</modelVersion>

      <groupId>com.walrusmc</groupId>

      <artifactId>${pluginName}</artifactId>

      <version>1.0.0</version>

      <packaging>jar</packaging>

      <properties>
          <maven.compiler.source>17</maven.compiler.source>
          <maven.compiler.target>17</maven.compiler.target>
      </properties>

      <repositories>
          <repository>
              <id>papermc-repo</id>
              <url>https://repo.papermc.io/repository/maven-public/</url>
          </repository>
          <repository>
              <id>sonatype</id>
              <url>https://oss.sonatype.org/content/groups/public/</url>
          </repository>
      </repositories>

      <dependencies>
          <dependency>
              <groupId>io.papermc.paper</groupId>
              <artifactId>paper-api</artifactId>
              <version>1.20.1-R0.1-SNAPSHOT</version>
              <scope>provided</scope>
          </dependency>

          <dependency>
              <groupId>net.kyori</groupId>
              <artifactId>adventure-api</artifactId>
              <version>4.14.0</version>
          </dependency>

          ${fullDependencies}

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
  `

  // Write files to GitHub
  log.debug("Writing code files to github.");
  await github.writeFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, pluginJava, "Initial commit", guildId);
  await github.writeFile(pluginName, `src/main/resources/plugin.yml`, pluginYML, "Initial commit", guildId);
  await github.writeFile(pluginName, `src/main/resources/config.yml`, configYML, "Initial commit", guildId);
  await github.writeFile(pluginName, `pom.xml`, pomXML, "Initial commit", guildId);
  await github.writeFile(pluginName, "dependencies.json", JSON.stringify(dependencyBlocks, null, 2), "Dependencies", guildId);

  // Build JAR
  const result = await buildJAR(pluginName, "1.0.0", pluginJava, pluginYML, configYML, pomXML, guildId, dependencyBlocks);
  if (result.success) {
    log.debug("Success! Writing plugin information to database");
    prisma.plugin.create({
      data: {
        name: pluginName,
        version: "1.0.0",
        description: pluginDescription,
        file: result.result,
        guildId
      }
    })
    prisma.download.create({
      data: {
        file: result.result,
        description: "A Minecraft plugin JAR created by you, Steve.",
        guildId
      }
    })

    return {
      name: "createNewPlugin",
      success: true,
      result: {
        name: pluginName,
        version: "1.0.0",
        description: pluginDescription,
        file: result.result
      }
    };
  } else {
    return result;
  }
}

/**
 * Edits a pre-existing plugin via deletions/insertions and dependency changes.
 */
plugin.edit = async function(
  pluginName,
  pluginDescription,
  deletions = [],
  insertions = [],
  addDependencies = [],
  removeDependencies = [],
  guildId?,
) {
  if (!guildId) throw new Error("Missing guildId for plugin.edit()");
  const sanitizedDeletions = Array.isArray(deletions) ? deletions : [];
  const sanitizedInsertions = Array.isArray(insertions) ? insertions : [];
  const dependenciesToAdd = Array.isArray(addDependencies) ? [...addDependencies] : [];
  const dependenciesToRemove = Array.isArray(removeDependencies) ? [...removeDependencies] : [];
  const pluginsDbPath = path.join("db", guildId, "plugins.json");

 const pluginInfo = await prisma.plugin.findFirst({
    where: {
      guildId,
      name: pluginName
    }
  })
  if (!pluginInfo) return { success: false, name: "editPlugin", error: "An unknown error has occurred. Do not call this tool again."}
  if (!pluginDescription?.length) pluginDescription = pluginInfo.description;

  // Each edit bumps the stored semver patch so generated jars stay unique.
  const currentVersion = pluginInfo.version || "1.0.0";
  const pluginVersion = bumpPatchVersion(currentVersion);

  let pluginJava = await github.getFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, guildId);
  let pluginYML = await github.getFile(pluginName, `src/main/resources/plugin.yml`, guildId);
  let configYML = await github.getFile(pluginName, `src/main/resources/config.yml`, guildId);

  let dependencies: string[] = [];
  try {
    dependencies = JSON.parse(await github.getFile(pluginName, "dependencies.json", guildId));
  } catch {
    dependencies = [];
  }
  if (!Array.isArray(dependencies)) dependencies = [];
  if (!Array.isArray(dependencies)) dependencies = [];

  const updatedPluginJava = applyTextChanges(pluginJava, "pluginJava", sanitizedDeletions, sanitizedInsertions);
  if (updatedPluginJava !== pluginJava) {
    log.info(`Applying changes to ${pluginName}.java`);
    pluginJava = updatedPluginJava;
    await github.writeFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, pluginJava, `Update ${pluginName}.java to ${pluginVersion}`, guildId);
  }

  const updatedPluginYML = applyTextChanges(pluginYML, "pluginYML", sanitizedDeletions, sanitizedInsertions);
  if (updatedPluginYML !== pluginYML) {
    log.info(`Applying changes to ${pluginName} plugin.yml`);
    pluginYML = updatedPluginYML;
    await github.writeFile(pluginName, `src/main/resources/plugin.yml`, pluginYML, `Update plugin.yml to ${pluginVersion}`, guildId);
  }

  const updatedConfigYML = applyTextChanges(configYML, "configYML", sanitizedDeletions, sanitizedInsertions);
  if (updatedConfigYML !== configYML) {
    log.info(`Applying changes to ${pluginName} config.yml`);
    configYML = updatedConfigYML;
    await github.writeFile(pluginName, `src/main/resources/config.yml`, configYML, `Update config.yml to ${pluginVersion}`, guildId);
  }

  if (dependenciesToRemove.length) {
    // Remove dependencies in reverse order so earlier indexes are unaffected.
    dependenciesToRemove
      .map((num) => Number.parseInt(String(num), 10))
      .filter(num => Number.isFinite(num))
      .sort((a, b) => b - a)
      .forEach(indexOneBased => {
        const idx = indexOneBased - 1;
        if (idx >= 0 && idx < dependencies.length) {
          dependencies.splice(idx, 1);
        }
      });
  }

  if (dependenciesToAdd.length) {
    // Append any newly requested dependency XML blocks.
    dependencies.push(...dependenciesToAdd);
  }

  const fullDependencies = dependencies.join("\n\n");
  const pomXML = `
<project xmlns="http://maven.apache.org/POM/4.0.0"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <groupId>com.walrusmc</groupId>

    <artifactId>${pluginName}</artifactId>

    <version>${pluginVersion}</version>

    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
    </properties>

    <repositories>
        <repository>
            <id>papermc-repo</id>
            <url>https://repo.papermc.io/repository/maven-public/</url>
        </repository>
        <repository>
            <id>sonatype</id>
            <url>https://oss.sonatype.org/content/groups/public/</url>
        </repository>
    </repositories>

    <dependencies>
        <dependency>
            <groupId>io.papermc.paper</groupId>
            <artifactId>paper-api</artifactId>
            <version>1.20.1-R0.1-SNAPSHOT</version>
            <scope>provided</scope>
        </dependency>

        <dependency>
            <groupId>net.kyori</groupId>
            <artifactId>adventure-api</artifactId>
            <version>4.14.0</version>
        </dependency>

        ${fullDependencies}

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

  await github.writeFile(pluginName, "pom.xml", pomXML, `Update pom.xml to ${pluginVersion}`, guildId);
  await github.writeFile(pluginName, "dependencies.json", JSON.stringify(dependencies, null, 2), "Update dependencies list", guildId);

  const result = await buildJAR(pluginName, pluginVersion, pluginJava, pluginYML, configYML, pomXML, guildId, dependencies);

  const pluginRecord: PluginDB = {
    name: pluginName,
    version: pluginVersion,
    description: pluginDescription,
    file: `${pluginName}-${pluginVersion}.jar`
  }

  if (result.success) {
    log.debug("Success! Writing plugin information to database");
    prisma.plugin.update({
      where: {
        id: pluginInfo.id,
        name: pluginName,
        guildId: guildId
      },
      data: pluginRecord
    });

    return {
      name: "createNewPlugin",
      success: true,
      result: pluginRecord
    };
  } else {
    return result;
  }

}
/**
 * Retrieves full pluginCode for each file specified
 * files = [pluginJava, pluginYML, configYML]
 */
plugin.retrieveCode = async function(pluginName, files, guildId) {

  const oldCode: CodeStrings = {};

  const pluginInfo = await prisma.plugin.findFirst({
    where: {
      guildId,
      name: pluginName
    }
  })
  if (!pluginInfo) return { success: false, name: "editPlugin", error: "An unknown error has occurred. Do not call this tool again."}
  oldCode.pluginJava = files.includes("pluginJava") ? await github.getFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, guildId) : undefined;
  oldCode.pluginYML = files.includes("pluginYML") ? await github.getFile(pluginName, `src/main/resources/plugin.yml`, guildId) : undefined;
  oldCode.configYML = files.includes("configYML") ? await github.getFile(pluginName, "src/main/resources/config.yml", guildId) : undefined;
  
  const newCode = codeStringsToLines(oldCode)

  return {
    name: "plugin.retrieveCode",
    success: true,
    result: {
      name: pluginName,
      description: pluginInfo.description,
      code: newCode
    },
  }
}
