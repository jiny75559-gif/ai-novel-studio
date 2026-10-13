import { useEffect, useState } from "react";
import { command, errorMessage } from "./bridge";
const cache = new Map<string, Promise<string>>();
export function preloadMedia(id: string) {
  let promise = cache.get(id);
  if (!promise) {
    promise = command<string>("media_data", { imageId: id });
    cache.set(id, promise);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return promise;
}
export function MediaImage({
  id,
  alt,
  className = "",
}: {
  id: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    setError("");
    if (!id) return;
    const request = preloadMedia(id);
    void request
      .then((s) => {
        if (live) setUrl(s);
      })
      .catch((e) => {
        cache.delete(id);
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [id]);
  return url ? (
    <img className={className} src={url} alt={alt} />
  ) : (
    <div className={`image-placeholder ${className}`}>
      {error || "读取图片…"}
    </div>
  );
}
