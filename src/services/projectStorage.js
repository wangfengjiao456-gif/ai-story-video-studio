import { parseProject, recoverProject, serializeProject } from "../model.js";
export const PROJECT_KEY = "story-studio-v1";
export const RECOVERY_KEY = `${PROJECT_KEY}.recovery`;
function readBackups(storage) {
  const raw = storage.getItem(RECOVERY_KEY);
  if (raw === null) return [];
  const backups = JSON.parse(raw);
  if (!Array.isArray(backups) || !backups.every((x) => typeof x === "string"))
    throw Error("恢复备份格式无效，已停止保存以保护原始数据。");
  return backups;
}
export function loadProject(storage) {
  let raw;
  try {
    raw = storage.getItem(PROJECT_KEY);
  } catch {
    return {
      project: null,
      recovery: true,
      raw: null,
      error: "无法读取本地存储。请检查浏览器存储权限，或导入 JSON 备份。",
    };
  }
  let backups = [],
    backupError = "";
  try {
    backups = readBackups(storage);
  } catch {
    backupError = "恢复备份无法读取，保存将被阻止；请保留浏览器数据。";
  }
  if (raw === null)
    return { project: null, recovery: false, backups, backupError };
  try {
    return {
      project: parseProject(raw),
      recovery: false,
      backups,
      backupError,
    };
  } catch (err) {
    return {
      project: recoverProject(raw),
      recovery: true,
      raw,
      error: err.message,
      backups,
      backupError,
    };
  }
}
export function saveProject(storage, project) {
  // Validate before any storage writes. A failed validation never touches the last save.
  const raw = serializeProject(project);
  const backups = readBackups(storage);
  const previous = storage.getItem(PROJECT_KEY);
  let archived = false;
  if (previous !== null) {
    try {
      parseProject(previous);
    } catch {
      if (!backups.includes(previous)) {
        backups.push(previous);
        // If this fails (e.g. quota), the original primary save stays intact.
        storage.setItem(RECOVERY_KEY, JSON.stringify(backups));
      }
      archived = true;
    }
  }
  storage.setItem(PROJECT_KEY, raw);
  return { raw, archived, backups };
}
