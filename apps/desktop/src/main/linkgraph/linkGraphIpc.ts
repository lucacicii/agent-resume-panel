import type { BrowserWindow } from "electron";
import { safeHandle } from "../ipcUtils";
import {
  analyzeLinkGraph,
  cancelLinkGraphAnalyze
} from "./linkGraphService";
import type { LinkGraphAnalyzeArgs } from "../../shared/linkGraphTypes";

export function registerLinkGraphIpc(getMainWindow: () => BrowserWindow | null, getSystemLocale: () => string): void {
  safeHandle("linkgraph:analyze", async (event, args: LinkGraphAnalyzeArgs) => {
    if (!args || typeof args !== "object") {
      throw new Error("无效的 Link Graph 参数");
    }
    if (typeof args.projectPath !== "string" || !args.projectPath.trim()) {
      throw new Error("无效的项目路径");
    }
    if (typeof args.filePath !== "string" || !args.filePath.trim()) {
      throw new Error("无效的文件路径");
    }
    if (typeof args.selection !== "string") {
      throw new Error("无效的选中文本");
    }

    return analyzeLinkGraph(args, {
      systemLocale: getSystemLocale(),
      onProgress: (progress) => {
        const win = getMainWindow();
        const sender = event.sender;
        if (!sender.isDestroyed()) {
          sender.send("linkgraph:progress", progress);
        } else if (win && !win.isDestroyed()) {
          win.webContents.send("linkgraph:progress", progress);
        }
      }
    });
  });

  safeHandle("linkgraph:cancel", async () => cancelLinkGraphAnalyze());
}
