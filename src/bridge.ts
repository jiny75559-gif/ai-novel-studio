import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppError } from "./domain";
export const desktop = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw {
      code: "DESKTOP_REQUIRED",
      userMessage: "请使用桌面程序打开工作台。浏览器只用于界面开发预览。",
    };
  return invoke<T>(name, args);
}
export function errorMessage(e: unknown): string {
  if (typeof e === "object" && e && "userMessage" in e)
    return (e as AppError).userMessage;
  if (e instanceof Error) return e.message;
  return "操作失败，请重试。";
}
