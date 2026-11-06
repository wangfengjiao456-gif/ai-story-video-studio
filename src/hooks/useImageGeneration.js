import { useEffect, useRef, useState } from "react";
import {
  generateSceneImage,
  generationSignature,
} from "../services/aiImages.js";
export default function useImageGeneration(project, onApply) {
  const latest = useRef(project),
    apply = useRef(onApply),
    request = useRef(null);
  latest.current = project;
  apply.current = onApply;
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate(id) {
    if (request.current) return;
    setTarget(id);
    const p = latest.current,
      scene = p.scenes.find((s) => s.id === id);
    if (!scene) return;
    let signature;
    try {
      signature = generationSignature(p, scene);
    } catch (err) {
      setError(err.message);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(id);
    setError("");
    try {
      const imageRef = await generateSceneImage(p, scene, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const current = latest.current.scenes.find((s) => s.id === id);
      let matches = false;
      try {
        matches =
          !!current &&
          generationSignature(latest.current, current) === signature;
      } catch {}
      if (matches) apply.current(id, imageRef);
      else {
        setPending({ id, imageRef });
        setError(
          "生成期间故事、角色或原图片已变化，结果未自动覆盖。你可以下载结果，或确认应用到原分镜。",
        );
      }
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  }
  return {
    busy,
    target,
    error,
    pending,
    generate,
    applyPending() {
      if (pending && latest.current.scenes.some((s) => s.id === pending.id)) {
        apply.current(pending.id, pending.imageRef);
        setPending(null);
        setError("");
      }
    },
    clearPending() {
      setPending(null);
    },
    reset() {
      request.current?.abort();
      request.current = null;
      setBusy(null);
      setError("");
      setPending(null);
    },
  };
}
