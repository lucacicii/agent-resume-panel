import { useEffect, useState } from "react";
import { isOwnedSelectionMenuTarget, resolveSelection } from "./resolveSelection";
import { SelectionSendMenu, type SelectionSendMenuState } from "./SelectionSendMenu";

export function SelectionSendHost(): React.JSX.Element | null {
  const [menu, setMenu] = useState<SelectionSendMenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (isOwnedSelectionMenuTarget(event.target)) return;
      const resolved = resolveSelection(event.target);
      if (!resolved) return;
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        text: resolved.text,
        ...(resolved.projectPath ? { projectPath: resolved.projectPath } : {})
      });
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => window.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  if (!menu) return null;
  return <SelectionSendMenu menu={menu} onClose={() => setMenu(null)} />;
}
