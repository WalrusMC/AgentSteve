import "dotenv/config";
import axios from "axios";
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
    throw new Error("Missing GITHUB_TOKEN environment variable required for GitHub integration.");
}
const api = axios.create({
    baseURL: "https://api.github.com",
    headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
    },
});
export const github = {
    async createRepo(repo, guildId) {
        const repos = await github.listRepos(guildId);
        if (repos.includes(repo))
            return false;
        await api.post("/user/repos", {
            name: `${guildId}-${repo}`,
            private: true,
        });
        return true;
    },
    async writeFile(repo, filePath, content, message, guildId) {
        const branch = "main";
        let sha;
        try {
            const existingFile = await api.get(`/repos/agent-steve-official/${guildId}-${repo}/contents/${filePath}`, {
                params: { ref: branch },
            });
            sha = existingFile.data.sha;
        }
        catch (err) {
            if (!axios.isAxiosError(err) || err.response?.status !== 404) {
                throw err;
            }
            // Ignore 404s so brand-new files can be created without a SHA.
        }
        return api.put(`/repos/agent-steve-official/${guildId}-${repo}/contents/${filePath}`, {
            message,
            content: Buffer.from(content, "utf-8").toString("base64"),
            branch,
            sha,
        });
    },
    async listRepos(guildId) {
        const res = await api.get("/user/repos");
        const scoped = res.data
            .map((repo) => repo.name)
            .filter((name) => name.startsWith(`${guildId}-`));
        return scoped.map((name) => name.replace(`${guildId}-`, ""));
    },
    async getFile(repo, filePath, guildId) {
        const branch = "main";
        const res = await api.get(`/repos/agent-steve-official/${guildId}-${repo}/contents/${filePath}`, {
            params: { ref: branch },
        });
        return Buffer.from(res.data.content, "base64").toString("utf-8");
    },
    async deleteRepo(repo, guildId) {
        await api.delete(`/repos/agent-steve-official/${guildId}-${repo}`);
    },
};
