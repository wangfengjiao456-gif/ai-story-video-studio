import { isFresh } from "../services/aiVoice.js";
// Records are append-ordered. Claim direct slots before filling reordered slots;
// never silently fall back to an older take when the newest backup is unavailable.
export function voiceRecoveryCandidates(project, records, speed) {
  const groups = new Set(),
    latest = [];
  for (const record of [...records].reverse()) {
    if (
      record.speed !== speed ||
      (!["article"].includes(record.key) && !/^scene-\d+$/.test(record.key))
    )
      continue;
    const group = JSON.stringify([record.key, record.text.trim(), speed]);
    if (groups.has(group)) continue;
    groups.add(group);
    latest.push(record);
  }
  const claimed = new Set(),
    used = new Set(),
    result = [];
  for (const record of latest) {
    let key;
    if (record.key === "article") {
      if (record.text.trim() === project.english.trim()) key = "article";
    } else {
      const scene = project.scenes[Number(record.key.slice(6))];
      if (scene?.english.trim() === record.text.trim()) key = scene.id;
    }
    if (key) {
      used.add(record);
      if (!claimed.has(key)) {
        claimed.add(key);
        result.push({ record, key });
      }
    }
  }
  for (const record of latest) {
    if (record.key === "article" || used.has(record)) continue;
    const scene = project.scenes.find(
      (s) => !claimed.has(s.id) && s.english.trim() === record.text.trim(),
    );
    if (scene) {
      claimed.add(scene.id);
      result.push({ record, key: scene.id });
    }
  }
  return result;
}
export function voiceMode(project, assets, speed) {
  if (isFresh(assets.article, project.english, speed)) return "article";
  if (
    project.scenes.some((s) => isFresh(assets[s.id], s.english, speed)) ||
    (project.voiceRecords || []).some(
      (r) =>
        /^scene-\d+$/.test(r.key) &&
        r.speed === speed &&
        project.scenes.some((s) => s.english.trim() === r.text.trim()),
    )
  )
    return "scenes";
  return project.english.trim().length <= 5000 ? "article" : "scenes";
}

export function hasMissingVoiceBackup(project, assets, speed, keys) {
  const wanted = new Set(keys);
  return voiceRecoveryCandidates(
    project,
    project.voiceRecords || [],
    speed,
  ).some(
    ({ key }) =>
      wanted.has(key) &&
      !isFresh(
        assets[key],
        key === "article"
          ? project.english
          : project.scenes.find((s) => s.id === key)?.english || "",
        speed,
      ),
  );
}

// Keep current scene takes even if one scene is regenerated many times.
export function appendVoiceRecord(records, record, project, limit = 100) {
  const all = [
    ...records.filter(
      (r) =>
        !(
          r.key === record.key &&
          r.fingerprint === record.fingerprint &&
          r.text.trim() === record.text.trim() &&
          r.speed === record.speed
        ),
    ),
    record,
  ];
  const chosen = new Set(
    voiceRecoveryCandidates(project, all, project.aiSpeed ?? record.speed)
      .slice(0, limit)
      .map((c) => c.record),
  );
  for (const value of [...all].reverse()) {
    if (chosen.size >= limit) break;
    chosen.add(value);
  }
  return all.filter((value) => chosen.has(value));
}
