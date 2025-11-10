const GH_API = "https://api.github.com";
const GH_TOKEN = process.env.GITHUB_TOKEN;

async function ghRequest(method, path, body = undefined) {
  if (!GH_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN in environment.");
  }
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await res.json();
  return await res.text();
}

export async function ghList(owner, repo, path = "", ref = undefined) {
  const encPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await ghRequest("GET", `/repos/${owner}/${repo}/contents/${encPath}${q}`);
  if (Array.isArray(data)) {
    return data.map((e) => ({ name: e.name, type: e.type, path: e.path, sha: e.sha, size: e.size || 0 }));
  } else {
    // Single file returned if path points to a file
    return [{ name: data.name, type: data.type, path: data.path, sha: data.sha, size: data.size || 0 }];
  }
}

export async function ghRead(owner, repo, path, ref = undefined) {
  const encPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await ghRequest("GET", `/repos/${owner}/${repo}/contents/${encPath}${q}`);
  if (data.type !== "file") throw new Error("Requested path is not a file.");
  const buff = Buffer.from(data.content || "", data.encoding || "base64");
  return { path: data.path, sha: data.sha, content: buff.toString("utf8") };
}

export async function ghWrite(owner, repo, path, content, message, branch, authorName = undefined, authorEmail = undefined) {
  const encPath = encodeURIComponent(path).replace(/%2F/g, "/");
  let existingSha = undefined;
  try {
    const current = await ghRequest("GET", `/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`);
    existingSha = current.sha;
  } catch (e) {
    // If 404, it's a create; otherwise rethrow
    if (!String(e.message).includes("404")) throw e;
  }
  const body = {
    message: message || `chore: update ${path}`,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (existingSha) body.sha = existingSha;
  if (authorName && authorEmail) body.committer = { name: authorName, email: authorEmail };
  const res = await ghRequest("PUT", `/repos/${owner}/${repo}/contents/${encPath}`, body);
  return { path: res.content?.path || path, sha: res.content?.sha, commitSha: res.commit?.sha, branch };
}

export async function ghCreatePR(owner, repo, head, base, title, body = "") {
  const pr = await ghRequest("POST", `/repos/${owner}/${repo}/pulls`, { title, head, base, body });
  return { number: pr.number, url: pr.html_url, state: pr.state, head: pr.head?.ref, base: pr.base?.ref };
}

export async function ghCreateRepo({ org = undefined, name, description = "", isPrivate = true, autoInit = true, gitignoreTemplate = undefined, licenseTemplate = undefined }) {
  const body = {
    name,
    description,
    private: !!isPrivate,
    auto_init: !!autoInit,
  };
  if (gitignoreTemplate) body.gitignore_template = gitignoreTemplate;
  if (licenseTemplate) body.license_template = licenseTemplate;
  const path = org ? `/orgs/${org}/repos` : "/user/repos";
  const repo = await ghRequest("POST", path, body);
  return { fullName: repo.full_name, htmlUrl: repo.html_url, defaultBranch: repo.default_branch, private: repo.private };
}

export async function ghAddCollaborator(owner, repo, username, permission = "push") {
  const body = { permission };
  const res = await ghRequest("PUT", `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, body);
  return { status: res?.permissions ? "added" : "invited" };
}

export async function ghListInvitations() {
  const invites = await ghRequest("GET", "/user/repository_invitations");
  return invites.map(i => ({ id: i.id, repo: i.repository?.full_name, permissions: i.permissions, url: i.html_url }));
}

export async function ghAcceptInvitation(invitationId) {
  await ghRequest("PATCH", `/user/repository_invitations/${invitationId}`);
  return { accepted: true, id: invitationId };
}
