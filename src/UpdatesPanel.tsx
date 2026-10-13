import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorMessage } from "./bridge";
import { Button, Field, Modal } from "./components";
interface UpdateInfo {
  version: string;
  notes: string;
  size: number;
  available: boolean;
  canInstall: boolean;
  local: boolean;
}
export function UpdatesPanel({
  onClose,
  beforeInstall,
}: {
  onClose: () => void;
  beforeInstall: () => Promise<boolean>;
}) {
  const [repository, setRepository] = useState("");
  const [savedRepository, setSavedRepository] = useState("");
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void Promise.all([
      command<{ repository: string }>("update_config"),
      command<{ version: string }>("app_info"),
    ])
      .then(([config, info]) => {
        if (!disposed) {
          setRepository(config.repository);
          setSavedRepository(config.repository);
          setVersion(info.version);
        }
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      });
    const subscription = listen<number>("update-progress", (e) => {
      if (!disposed) setDownloaded(e.payload);
    });
    return () => {
      disposed = true;
      void subscription.then((stop) => stop());
    };
  }, []);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    await perform(async () => {
      if (!(await beforeInstall()))
        throw new Error("当前正文保存失败，请先解决保存问题再更新。");
      if (!ready) {
        setMessage("正在下载更新包，当前软件仍可保留…");
        setDownloaded(0);
        await command("download_update");
        setReady(true);
        // Preserve any editor changes made while the request was downloading.
        if (!(await beforeInstall()))
          throw new Error("正文未能保存，更新包已下载，可稍后安装。");
      }
      setMessage("更新包已校验，正在备份作品并安装…");
      await command("install_update");
    });
  };
  return (
    <Modal
      title="软件更新"
      subtitle={`当前版本 ${version ? `v${version}` : "…"} · 保留本机作品、模型与阅读记录`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Field
        label="GitHub 更新仓库"
        hint="小说工作台使用独立仓库，与酒馆插件分开。"
      >
        <input
          aria-label="GitHub 更新仓库"
          disabled={busy}
          value={repository}
          onChange={(e) => {
            setRepository(e.target.value);
            setUpdate(null);
            setReady(false);
          }}
          placeholder="用户名/仓库名"
        />
      </Field>
      <div className="update-actions">
        <Button
          disabled={busy || !repository.trim()}
          onClick={() =>
            void perform(async () => {
              const result = await command<{ repository: string }>(
                "save_update_config",
                { value: repository },
              );
              setRepository(result.repository);
              setSavedRepository(result.repository);
              setUpdate(null);
              setReady(false);
              setMessage("更新仓库已保存。");
            })
          }
        >
          保存仓库
        </Button>
        <Button
          disabled={busy || repository !== savedRepository || !repository}
          onClick={() =>
            void perform(async () => {
              setUpdate(null);
              setReady(false);
              const info = await command<UpdateInfo>("check_update");
              setUpdate(info);
              setMessage(
                info.available
                  ? `发现新版 v${info.version}`
                  : "已经是当前发布的最新版本。",
              );
            })
          }
        >
          检查新版
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              setUpdate(null);
              setReady(false);
              const info = await command<UpdateInfo | null>(
                "choose_local_update",
              );
              if (info) {
                setUpdate(info);
                setReady(true);
                setMessage(
                  info.canInstall
                    ? `本地更新包 v${info.version} 已校验。`
                    : `本地更新包 v${info.version} 比当前版本更旧，不能覆盖。`,
                );
              }
            })
          }
        >
          选择本地更新包
        </Button>
      </div>
      {update && (
        <div className="generation-advice update-details">
          <strong>
            v{update.version} · {(update.size / 1024 / 1024).toFixed(1)} MB
          </strong>
          <p className="update-notes">{update.notes}</p>
          <p>
            当前正文会自动保存。尚未提交的设置请先保存；安装时软件会关闭，再自动打开新版。
          </p>
          <Button
            variant="primary"
            busy={busy}
            disabled={
              !update.canInstall || (!update.available && !update.local)
            }
            onClick={() => void install()}
          >
            {ready ? "安装此更新包" : "一键下载并更新"}
          </Button>
        </div>
      )}
      {busy && downloaded > 0 && (
        <p>
          已下载 {(downloaded / 1024 / 1024).toFixed(1)} MB
          {update ? ` / ${(update.size / 1024 / 1024).toFixed(1)} MB` : ""}
        </p>
      )}
      {error && (
        <p className="inline-note" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p className="workflow-note">
        更新包只包含新版软件，无需重下离线运行组件。离线安装包用于首次安装或换电脑；下载失败会保留当前软件。
      </p>
      <footer>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
      </footer>
    </Modal>
  );
}
