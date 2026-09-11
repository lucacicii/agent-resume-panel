import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { useI18n } from "../../../i18n";
import type {
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphOutputLanguage,
  LinkGraphProgressEvent
} from "../../../../shared/linkGraphTypes";

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

export function useWorkbenchLinkGraph(options: {
  onOpenSide: () => void;
}): {
  linkGraphResult: LinkGraphAnalyzeResult | null;
  linkGraphProgress: LinkGraphProgressEvent | null;
  linkGraphBusy: boolean;
  linkGraphError: string | null;
  linkGraphLanguage: LinkGraphOutputLanguage;
  runLinkGraph: (args: LinkGraphAnalyzeArgs) => Promise<void>;
  refreshLinkGraph: () => void;
  changeLinkGraphLanguage: (value: LinkGraphOutputLanguage) => void;
  cancelLinkGraph: () => void;
} {
  const { onOpenSide } = options;
  const { t } = useI18n();
  const [linkGraphResult, setLinkGraphResult] = useState<LinkGraphAnalyzeResult | null>(null);
  const [linkGraphProgress, setLinkGraphProgress] = useState<LinkGraphProgressEvent | null>(null);
  const [linkGraphBusy, setLinkGraphBusy] = useState(false);
  const [linkGraphError, setLinkGraphError] = useState<string | null>(null);
  const [linkGraphLanguage, setLinkGraphLanguage] = useState<LinkGraphOutputLanguage>(() => {
    try {
      const stored = localStorage.getItem("wb-linkgraph-lang") || "";
      return stored === "en" || stored === "zh-cn" || stored === "ja" || stored === "auto" ? stored : "auto";
    } catch {
      return "auto";
    }
  });
  const linkGraphSeedRef = useRef<LinkGraphAnalyzeArgs | null>(null);
  const linkGraphLanguageRef = useRef(linkGraphLanguage);
  linkGraphLanguageRef.current = linkGraphLanguage;
  const onOpenSideRef = useRef(onOpenSide);
  onOpenSideRef.current = onOpenSide;

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onLinkGraphProgress !== "function") return;
    return api.onLinkGraphProgress((event) => {
      setLinkGraphProgress(event);
    });
  }, []);

  const runLinkGraph = useCallback(async (args: LinkGraphAnalyzeArgs) => {
    const api = desktopApi();
    if (typeof api.linkGraphAnalyze !== "function") {
      setLinkGraphError(t("desktop.workbench.linkGraphFailed", "unavailable"));
      onOpenSideRef.current();
      return;
    }
    linkGraphSeedRef.current = { ...args, outputLanguage: linkGraphLanguageRef.current };
    onOpenSideRef.current();
    setLinkGraphBusy(true);
    setLinkGraphError(null);
    setLinkGraphProgress(null);
    try {
      const result = await api.linkGraphAnalyze({
        ...args,
        outputLanguage: args.outputLanguage || linkGraphLanguageRef.current
      });
      setLinkGraphResult(result);
      if (result.stopReason === "invalid_seed" || result.stopReason === "empty_seed") {
        setLinkGraphError(t("desktop.workbench.linkGraphNeedSelection"));
      } else {
        setLinkGraphError(null);
      }
    } catch (error) {
      setLinkGraphError(t("desktop.workbench.linkGraphFailed", statusError(error)));
    } finally {
      setLinkGraphBusy(false);
    }
  }, [t]);

  const refreshLinkGraph = useCallback(() => {
    const seed = linkGraphSeedRef.current;
    if (!seed) return;
    void runLinkGraph({ ...seed, outputLanguage: linkGraphLanguageRef.current });
  }, [runLinkGraph]);

  const changeLinkGraphLanguage = useCallback((value: LinkGraphOutputLanguage) => {
    setLinkGraphLanguage(value);
    localStorage.setItem("wb-linkgraph-lang", value);
    linkGraphLanguageRef.current = value;
    const seed = linkGraphSeedRef.current;
    if (seed && (linkGraphResult?.primaryChain.length || linkGraphResult?.hits.length)) {
      void runLinkGraph({ ...seed, outputLanguage: value });
    }
  }, [linkGraphResult?.hits.length, linkGraphResult?.primaryChain.length, runLinkGraph]);

  const cancelLinkGraph = useCallback(() => {
    void desktopApi().linkGraphCancel().catch(() => undefined);
    setLinkGraphBusy(false);
  }, []);

  return {
    linkGraphResult,
    linkGraphProgress,
    linkGraphBusy,
    linkGraphError,
    linkGraphLanguage,
    runLinkGraph,
    refreshLinkGraph,
    changeLinkGraphLanguage,
    cancelLinkGraph
  };
}
