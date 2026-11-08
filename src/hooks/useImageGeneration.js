import { mediaKey, readMedia, writeMedia } from "../creation/mediaStore.js";
import { validateImageRef } from "../services/images.js";
import { coverScene } from "../creation/project.js";
import { useEffect, useRef, useState } from "react";
import {
  generateSceneImage,
  generationSignature,
} from "../services/aiImages.js";
export default function useImageGeneration(project, onApply) {
  const latest = useRef(project),
    apply = useRef(onApply),
    request = useRef(null),
    pendingRef = useRef(null);
  latest.current = project;
  apply.current = onApply;
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(null),
    [error, setError] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [pending, setPending] = useState(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate(id) {
    if (request.current) return;
    if (pendingRef.current) {
      setError(
        "请先下载并处理未应用的生成图片，再开始新的生成；原结果已保留。",
      );
      return;
    }
    setTarget(id);
    const p = latest.current,
      scene =
        id === "cover-00" ? coverScene(p) : p.scenes.find((s) => s.id === id);
    if (!scene) return;
    let signature;
    try {
      signature = generationSignature(
        id === "cover-00" ? { ...p, ratio: "9:16" } : p,
        scene,
      );
    } catch (err) {
      setError(err.message);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(id);
    setError("");
    setStorageWarning("");
    try {
      const imageRef = await generateSceneImage(
        id === "cover-00" ? { ...p, ratio: "9:16" } : p,
        scene,
        {
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      let mediaSaved = true;
      try {
        await writeMedia(await mediaKey("image", signature), {
          kind: "image",
          imageRef,
        });
      } catch (error) {
        mediaSaved = false;
        setStorageWarning(error.message);
      }
      if (controller.signal.aborted || request.current !== controller) return;
      const current =
        id === "cover-00"
          ? coverScene(latest.current)
          : latest.current.scenes.find((s) => s.id === id);
      let matches = false;
      try {
        matches =
          !!current &&
          generationSignature(
            id === "cover-00"
              ? { ...latest.current, ratio: "9:16" }
              : latest.current,
            current,
          ) === signature;
      } catch {}
      if (matches) {
        apply.current(id, imageRef);
        return { ...imageRef, mediaSaved };
      } else {
        pendingRef.current = { id, imageRef };
        setPending(pendingRef.current);
        setError(
          "生成期间故事、角色或原图片已变化，结果未自动覆盖。你可以下载结果，或确认应用到原分镜。",
        );
      }
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
      return {
        failed: true,
        error: err.message || "生成未完成，请检查后再手动继续。",
      };
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  }
  async function restoreScene(id, replace = false) {
    if (request.current || pendingRef.current) return false;
    const p = latest.current,
      scene =
        id === "cover-00" ? coverScene(p) : p.scenes.find((s) => s.id === id);
    if (!scene || (!replace && scene.imageRef)) return false;
    const project = id === "cover-00" ? { ...p, ratio: "9:16" } : p,
      signature = generationSignature(project, scene);
    let record;
    try {
      record = await readMedia(await mediaKey("image", signature));
    } catch (error) {
      setStorageWarning(error.message);
      return false;
    }
    if (record?.kind !== "image" || !record.imageRef) return false;
    try {
      validateImageRef(record.imageRef);
    } catch {
      setStorageWarning("本机图片备份无效，原图未覆盖。");
      return false;
    }
    const current =
      id === "cover-00"
        ? coverScene(latest.current)
        : latest.current.scenes.find((s) => s.id === id);
    if (
      !current ||
      generationSignature(
        id === "cover-00"
          ? { ...latest.current, ratio: "9:16" }
          : latest.current,
        current,
      ) !== signature
    )
      return false;
    if (current.imageRef) {
      pendingRef.current = { id, imageRef: record.imageRef };
      setPending(pendingRef.current);
      setTarget(id);
      setError("找到本机生成备份；请先下载或确认应用，不会自动覆盖当前图片。");
    } else apply.current(id, record.imageRef);
    return true;
  }
  async function restoreMissing() {
    const p = latest.current;
    let count = 0;
    for (const id of [
      ...(p.cover?.enabled && !p.cover.imageRef ? ["cover-00"] : []),
      ...p.scenes.filter((s) => !s.imageRef).map((s) => s.id),
    ])
      if (await restoreScene(id)) count++;
    return count;
  }
  return {
    busy,
    target,
    error,
    storageWarning,
    restoreMissing,
    restoreScene,
    pending,
    generate,
    applyPending() {
      if (
        pending &&
        (pending.id === "cover-00" ||
          latest.current.scenes.some((s) => s.id === pending.id))
      ) {
        apply.current(pending.id, pending.imageRef);
        pendingRef.current = null;
        setPending(null);
        setError("");
      }
    },
    clearPending() {
      pendingRef.current = null;
      setPending(null);
    },
    reset() {
      setStorageWarning("");
      request.current?.abort();
      request.current = null;
      setBusy(null);
      setError("");
      pendingRef.current = null;
      setPending(null);
    },
  };
}
