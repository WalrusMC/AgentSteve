import fs from "fs/promises";
import { createLogger } from "./logger.js";

const log = createLogger("whitelist");

export async function loadWhitelist(guildId) {
  try {
    const raw = await fs.readFile(`./db/${guildId}/whitelist.json`, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
    };
  } catch (e) {
    log.warn("Failed to read whitelist, resetting:", e?.message || e);
    return { users: [], roles: [] };
  }
}

async function saveWhitelist(data, guildId) {
  await fs.writeFile(`./db/${guildId}/whitelist.json`, JSON.stringify(data, null, 2));
}

export async function isUserAllowed(member, guildId) {
  const wl = await loadWhitelist(guildId);
  if (!member) return false;
  if (wl.users.includes(member.id)) return true;
  const memberRoleIds = member.roles?.cache ? Array.from(member.roles.cache.keys()) : [];
  return memberRoleIds.some((rid) => wl.roles.includes(rid));
}

export async function allowUser(userId, guildId) {
  const wl = await loadWhitelist(guildId);
  if (!wl.users.includes(userId)) wl.users.push(userId);
  await saveWhitelist(wl, guildId);
  return wl;
}

export async function allowRole(roleId, guildId) {
  const wl = await loadWhitelist(guildId);
  if (!wl.roles.includes(roleId)) wl.roles.push(roleId);
  await saveWhitelist(wl, guildId);
  return wl;
}

export async function disallowUser(userId, guildId) {
  const wl = await loadWhitelist(guildId);
  wl.users = wl.users.filter((id) => id !== userId);
  await saveWhitelist(wl, guildId);
  return wl;
}

export async function disallowRole(roleId, guildId) {
  const wl = await loadWhitelist(guildId);
  wl.roles = wl.roles.filter((id) => id !== roleId);
  await saveWhitelist(wl, guildId);
  return wl;
}
