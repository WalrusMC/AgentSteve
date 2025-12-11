import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from "../utils/logger.js";
import { createRepo, writeFile, getFile } from "../utils/github.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createLogger("plugin");

const run = promisify(exec);

export const plugin = {};

const bumpPatchVersion = (version = "1.0.0") => {
  const parts = `${version}`.split(".").map(part => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return parts.join(".");
};

/**
 * Apply the requested deletions/insertions to a text file.
 */
const applyTextChanges = (content, fileKey, deletions = [], insertions = []) => {
  if (!content?.length) return content;
  const lines = content.split("\n");

  deletions
    .filter(entry => entry?.file === fileKey)
    .sort((a, b) => (Number.parseInt(b.startLine, 10) || 0) - (Number.parseInt(a.startLine, 10) || 0))
    .forEach(({ startLine, endLine }) => {
      const startLineValue = Number.parseInt(startLine, 10) || 1;
      const endLineValueRaw = Number.parseInt(endLine, 10);
      const endLineValue = Number.isFinite(endLineValueRaw) ? Math.max(startLineValue, endLineValueRaw) : startLineValue;
      const startIdx = Math.max(0, startLineValue - 1);
      const deleteCount = Math.max(0, endLineValue - startLineValue + 1);
      lines.splice(startIdx, deleteCount);
    });

  insertions
    .filter(entry => entry?.file === fileKey)
    .sort((a, b) => (Number.parseInt(a.startLine, 10) || 0) - (Number.parseInt(b.startLine, 10) || 0))
    .forEach(({ startLine, content: insertionContent }) => {
      if (typeof insertionContent !== "string") return;
      const insertionLineValue = Number.parseInt(startLine, 10);
      const insertionIdx = Math.max(0, Math.min(lines.length, Number.isFinite(insertionLineValue) ? insertionLineValue : 0));
      const insertionLines = insertionContent.split("\n");
      lines.splice(insertionIdx, 0, ...insertionLines);
    });

  return lines.join("\n");
};

/**
 * {
 *  success: true/false
 *  file: undefined/filename
 *  error: undefined/errorreport
 * }
 */
async function buildJAR(pluginName, pluginVersion, pluginJava, pluginYML, configYML, pomXML, guildId, dependencies = []) {
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
      counter++;
      lines.push( { dependency: counter, block: dependency } );
    }
    dependenciesArray.push(... lines);
  };

// Generate temp build directory structure and build the jar
  const builderRoot = path.join(__dirname, "pluginBuilder", guildId);
  const javaDir = path.join(builderRoot, "src", "main", "java", "com", "walrusmc");
  const resourcesDir = path.join(builderRoot, "src", "main", "resources");
  const pomPath = path.join(builderRoot, "pom.xml");
  const storedGuildDir = path.join(__dirname, "downloads", guildId);
  const jarOutputName = `${pluginName}-${pluginVersion}.jar`;

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
    await run("mvn -f pom.xml clean package", { cwd: builderRoot });

    const targetDir = path.join(builderRoot, "target");
    const files = await fs.readdir(targetDir);
    const builtJar = files.find(file => file.endsWith(".jar"));

    if (!builtJar) {
      throw new Error("Maven build completed but no JAR was produced.");
    }

    await fs.rename(path.join(targetDir, builtJar), path.join(storedGuildDir, jarOutputName));

    log.info(`Built plugin JAR: ${jarOutputName}`);
    return { 
      success: true,
      file: jarOutputName,
    };
  } catch (err) {
    log.error("Maven build failed:", err?.stderr || err?.stdout || err?.message || err);
    return {
      success: false,
      error: err.stderr || err.stdout || err.message,
      pluginName: pluginName,
      version: pluginVersion,
      code: {
        pluginJava: pluginJava,
        pljuginYML: pluginYML,
        configYML: configYML,
        dependencies: dependenciesArray
      },
    };
  } finally {
    await fs.rm(builderRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Creates a new plugin and returns buildJAR
 */
plugin.createNew = async function(pluginName, pluginDescription, pluginJava, pluginYML, configYML = "# No config right now", dependencies = [], guildId) {
  if (!configYML?.length) configYML = "# No config right now";

  // Create GitHub Repo
  if (!await createRepo(pluginName, guildId)) return { success: false, error: "You tried to create a new plugin, but a plugin with that name already exists!" }

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
  await writeFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, pluginJava, "Initial commit", guildId);
  await writeFile(pluginName, `src/main/resources/plugin.yml`, pluginYML, "Initial commit", guildId);
  await writeFile(pluginName, `src/main/resources/config.yml`, configYML, "Initial commit", guildId);
  await writeFile(pluginName, `pom.xml`, pomXML, "Initial commit", guildId);
  await writeFile(pluginName, "dependencies.json", JSON.stringify(dependencyBlocks, null, 2), "Dependencies", guildId);

  // Write file name to db
  const pluginsDbPath = path.join("db", guildId, "plugins.json");
  let pluginsDb = [];
  try {
    pluginsDb = JSON.parse(await fs.readFile(pluginsDbPath, "utf8"));
  } catch {
    pluginsDb = [];
  }
  pluginsDb.push({
    name: pluginName,
    pluginName,
    version: "1.0.0",
    description: pluginDescription,
  });

  await fs.writeFile(pluginsDbPath, JSON.stringify(pluginsDb, null, 2));

  // Build JAR
  return await buildJAR(pluginName, "1.0.0", pluginJava, pluginYML, configYML, pomXML, guildId, dependencyBlocks);

}

/**
 * Edits a pre-existing plugin via deletions/insertions and dependency changes.
 */
plugin.edit = async function(pluginName, pluginDescription, deletions = [], insertions = [], addDependencies = [], removeDependencies = [], guildId) {
  const sanitizedDeletions = Array.isArray(deletions) ? deletions : [];
  const sanitizedInsertions = Array.isArray(insertions) ? insertions : [];
  const dependenciesToAdd = Array.isArray(addDependencies) ? [...addDependencies] : [];
  const dependenciesToRemove = Array.isArray(removeDependencies) ? [...removeDependencies] : [];
  const pluginsDbPath = path.join("db", guildId, "plugins.json");

  const pluginInfo = JSON.parse(await fs.readFile(`./db/${guildId}/plugins.json`, "utf8")).find(obj => obj.name === pluginName);
  if (!pluginDescription?.length) pluginDescription = pluginInfo.description;

  let pluginsDb = [];
  try {
    pluginsDb = JSON.parse(await fs.readFile(pluginsDbPath, "utf8"));
  } catch {
    pluginsDb = [];
  }

  // Each edit bumps the stored semver patch so generated jars stay unique.
  const matchesPlugin = (obj = {}) => obj.name === pluginName || obj.pluginName === pluginName;
  const existingPlugin = pluginsDb.find(matchesPlugin);
  const currentVersion = existingPlugin?.version || "1.0.0";
  const pluginVersion = bumpPatchVersion(currentVersion);

  let pluginJava = await getFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, guildId);
  let pluginYML = await getFile(pluginName, `src/main/resources/plugin.yml`, guildId);
  let configYML = await getFile(pluginName, `src/main/resources/config.yml`, guildId);

  let dependencies = [];
  try {
    dependencies = JSON.parse(await getFile(pluginName, "dependencies.json", guildId));
  } catch {
    dependencies = [];
  }
  if (!Array.isArray(dependencies)) dependencies = [];
  if (!Array.isArray(dependencies)) dependencies = [];

  const updatedPluginJava = applyTextChanges(pluginJava, "pluginJava", sanitizedDeletions, sanitizedInsertions);
  if (updatedPluginJava !== pluginJava) {
    log.info(`Applying changes to ${pluginName}.java`);
    pluginJava = updatedPluginJava;
    await writeFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, pluginJava, `Update ${pluginName}.java to ${pluginVersion}`, guildId);
  }

  const updatedPluginYML = applyTextChanges(pluginYML, "pluginYML", sanitizedDeletions, sanitizedInsertions);
  if (updatedPluginYML !== pluginYML) {
    log.info(`Applying changes to ${pluginName} plugin.yml`);
    pluginYML = updatedPluginYML;
    await writeFile(pluginName, `src/main/resources/plugin.yml`, pluginYML, `Update plugin.yml to ${pluginVersion}`, guildId);
  }

  const updatedConfigYML = applyTextChanges(configYML, "configYML", sanitizedDeletions, sanitizedInsertions);
  if (updatedConfigYML !== configYML) {
    log.info(`Applying changes to ${pluginName} config.yml`);
    configYML = updatedConfigYML;
    await writeFile(pluginName, `src/main/resources/config.yml`, configYML, `Update config.yml to ${pluginVersion}`, guildId);
  }

  if (dependenciesToRemove.length) {
    // Remove dependencies in reverse order so earlier indexes are unaffected.
    dependenciesToRemove
      .map(num => Number.parseInt(num, 10))
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

  await writeFile(pluginName, "pom.xml", pomXML, `Update pom.xml to ${pluginVersion}`, guildId);
  await writeFile(pluginName, "dependencies.json", JSON.stringify(dependencies, null, 2), "Update dependencies list", guildId);

  const pluginRecord = {
    name: pluginName,
    version: pluginVersion,
    description: pluginDescription
  };
  const pluginIndex = pluginsDb.findIndex(matchesPlugin);
  if (pluginIndex === -1) {
    pluginsDb.push(pluginRecord);
  } else {
    pluginsDb[pluginIndex] = pluginRecord;
  }
  await fs.writeFile(pluginsDbPath, JSON.stringify(pluginsDb, null, 2));

  return await buildJAR(pluginName, pluginVersion, pluginJava, pluginYML, configYML, pomXML, guildId, dependencies);

}
/**
 * Retrieves full pluginCode for each file specified
 * files = [pluginJava, pluginYML, configYML]
 */
plugin.retrieveCode = async function(pluginName, files, guildId) {

  let code = {};

  pluginInfo = JSON.parse(await fs.readFile(`./db/${guildId}/plugins.json`, "utf8")).find(obj => obj.name === pluginName);
  pluginDescription = pluginInfo.description;
  code.pluginJava = files.includes("pluginJava") ? await getFile(pluginName, `src/main/java/com/walrusmc/${pluginName}.java`, guildId) : false;
  code.pluginYML = files.includes("pluginYML") ? await getFile(pluginName, `src/main/resources/plugin.yml`, guildId) : false;
  code.configYML = files.includes("configYML") ? await getFile(pluginName, "src/main/resources/config.yml", guildId) : false;
  let dependencies = [];
  try {
    dependencies = JSON.parse(await getFile(pluginName, "dependencies.json", guildId));
  } catch {
    dependencies = [];
  }
  
  code.dependencies = [ 
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
    code.pluginJava = lines;
  } else {
    code.pluginJava = `You did not ask for the ${pluginName}.java code.`;
  }

  if (code?.pluginYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.pluginYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    code.pluginYML = lines;
  } else {
    code.pluginYML = "You did not ask for the plugin.yml code.";
  }

  if (code?.configYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.configYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    code.configYML = lines;
  } else {
    code.configYML = "You did not ask for the config.yml code.";
  }

  if (dependencies?.length) {
    counter = 2;
    lines = [];
    for (const dependency of dependencies) {
      counter++;
      lines.push( { dependency: counter, block: dependency } );
    }
    code.dependencies.push(... lines);
  }

  return JSON.stringify({
    pluginName,
    pluginDescription: pluginDescription,
    pluginJava: code.pluginJava,
    pluginYML: code.pluginYML,
    configYML: code.configYML,
    dependencies: code.dependencies
  }, null, 2);
}

/**
 * generates a plugin crash report
 */
plugin.crashReport = async function(pluginName, version, code, error) {
  pluginInfo = JSON.parse(await fs.readFile(`./db/${guildId}/plugins.json`, "utf8")).find(obj => obj.name === pluginName);
  pluginDescription = pluginInfo.description;
  // Add line numbers to files
  if (code?.pluginJava) {
    let counter = 0;
    const lines = [];
    for (const line of code.pluginJava.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    code.pluginJava = lines;
  } else {
    code.pluginJava = `Could not find ${pluginName}.java`;
  }

  if (code?.pluginYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.pluginYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    code.pluginYML = lines;
  } else {
    code.pluginYML = "Could not find plugin.yml";
  }

  if (code?.configYML) {
    let counter = 0;
    const lines = [];
    for (const line of code.configYML.split("\n")) {
      counter++;
      lines.push( { line: counter, text: line } );
    }
    code.configYML = lines;
  } else {
    code.configYML = "Could not find config.yml";
  }

return `Here is the crash report, code, and plugin information:
----- BEGINNING OF PLUGIN INFO -----
${JSON.stringify({
    pluginName,
    pluginDescription,
    pluginJava: code.pluginJava,
    pluginYML: code.pluginYML,
    configYML: code.configYML,
    dependencies: code.dependencies
  }, null, 2)}
----- END OF PLUGIN INFO -----

Here is the Maven crash report:
----- BEGINNING OF MAVEN CRASH REPORT -----
${error}
----- END OF MAVEN CRASH REPORT -----`
}
