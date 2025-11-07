import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = promisify(exec);

export async function createPlugin(pluginJava, pluginYML, configYML, pluginVersion, pluginName, dependencies) {

  let fullDependencies = "";
  if (dependencies) for (const dependency of dependencies) {
    fullDependencies += dependency;
  }

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
  `


  // Generate directory
  await fs.mkdir(path.join(__dirname, "pluginBuilder"), { recursive: true });
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src"));
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src/main"));
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src/main/resources"));
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src/main/java"));
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src/main/java/com"));
  await fs.mkdir(path.join(__dirname, "pluginBuilder/src/main/java/com/walrusmc"));

  // Plugin.java
  await fs.writeFile(path.join(__dirname, "pluginBuilder/src/main/java/com/walrusmc", `${pluginName}.java`), pluginJava);

  // config.yml
  await fs.writeFile(path.join(__dirname, "pluginBuilder/src/main/resources/config.yml"), configYML)

  // plugin.yml
  await fs.writeFile(path.join(__dirname, "pluginBuilder/src/main/resources/plugin.yml"), pluginYML);

  // pom.xml
  await fs.writeFile(path.join(__dirname, "pluginBuilder/pom.xml"), pomXML);

  try {
    await run("mvn -f src/tools/pluginBuilder/pom.xml clean package");
  } catch (err) {
    await fs.rm(path.join(__dirname, "pluginBuilder"), { recursive: true } );
    return {
      success: false,
      error: err.stderr || err.stdout || err.message,
    };
  }

  const files = await fs.readdir(path.join(__dirname, "pluginBuilder/target"));
  let fileJarName = "";

  for (const file of files) {
    if (file.endsWith(".jar")) {
      fileJarName = file;
    }
  }

  await fs.rename(path.join(__dirname, `pluginBuilder/target/${fileJarName}`), path.join(__dirname, `storedFiles/${pluginName}-${pluginVersion}.jar`));

  await fs.rm(path.join(__dirname, "pluginBuilder"), { recursive: true } );

  return { 
    success: true,
    file: fileJarName,
  };

};