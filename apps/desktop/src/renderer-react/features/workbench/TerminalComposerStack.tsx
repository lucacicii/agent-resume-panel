import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type { SessionDotStatus } from "./activeSessionDots";
import type { WorkbenchComposerSlashPhrase } from "@agent-resume/core";
import {
  TerminalComposer,
  type ComposerSendTip,
  type TerminalComposerPane
} from "./TerminalComposer";
import {
  loadTerminalComposerPosition,
  saveTerminalComposerPosition
} from "./terminalComposerHistory";

export const COMPOSER_STACK_POSITION_KEY = "workbench";

export type TerminalComposerStackItem = {
  pane: TerminalComposerPane;
  ptyId: number | null;
  activePane: boolean;
  projectName: string;
  sessionTitle: string;
  status: SessionDotStatus;
  value: string;
  tips: ComposerSendTip[];
};

export function TerminalComposerStack(props: {
  items: TerminalComposerStackItem[];
  onChange: (paneKey: string, value: string) => void;
  onSendToTerminal: (paneKey: string) => void;
  onActivate: (paneKey: string) => void;
  onOpenTip: (paneKey: string, tip: ComposerSendTip) => void;
  onClose: (paneKey: string) => void;
  registerFocus: (key: string, focus: () => void) => () => void;
  slashPhrases?: WorkbenchComposerSlashPhrase[];
}): React.JSX.Element | null {
  const { items, onChange, onSendToTerminal, onActivate, onOpenTip, onClose, registerFocus, slashPhrases = [] } = props;
  const { t } = useI18n();
  const stackRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => loadTerminalComposerPosition(COMPOSER_STACK_POSITION_KEY));
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const beginStackDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: position.x,
      origY: position.y
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [position.x, position.y]);

  const moveStackDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shell = stackRef.current?.closest<HTMLElement>(".wb-terminal-shell");
    const shellWidth = shell?.clientWidth || window.innerWidth;
    const shellHeight = shell?.clientHeight || window.innerHeight;
    const selfWidth = stackRef.current?.clientWidth || 0;
    const selfHeight = stackRef.current?.clientHeight || 0;
    const maxX = Math.max(4, Math.min(shellWidth - 564, shellWidth - selfWidth - 4));
    const maxY = Math.max(4, shellHeight - selfHeight - 4);
    const x = Math.min(Math.max(4, drag.origX + event.clientX - drag.startX), maxX);
    const y = Math.min(Math.max(4, drag.origY - (event.clientY - drag.startY)), maxY);
    setPosition({ x, y });
  }, []);

  const endStackDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    saveTerminalComposerPosition(COMPOSER_STACK_POSITION_KEY, positionRef.current);
  }, []);

  if (!items.length) return null;

  return (
    <div
      ref={stackRef}
      className="wb-terminal-composer-stack"
      style={{ left: position.x, bottom: position.y }}
    >
      <button
        type="button"
        className="wb-terminal-composer-grip"
        aria-label={t("desktop.workbench.terminalComposerMove")}
        title={t("desktop.workbench.terminalComposerMove")}
        onPointerDown={beginStackDrag}
        onPointerMove={moveStackDrag}
        onPointerUp={endStackDrag}
        onPointerCancel={endStackDrag}
        onLostPointerCapture={endStackDrag}
      >
        <ThemeIcon name="grip-vertical" size={16} aria-hidden="true" />
      </button>
      <div className="wb-terminal-composer-stack-list">
        {items.map((item) => (
          <TerminalComposer
            key={item.pane.key}
            pane={item.pane}
            ptyId={item.ptyId}
            activePane={item.activePane}
            projectName={item.projectName}
            sessionTitle={item.sessionTitle}
            status={item.status}
            value={item.value}
            tips={item.tips}
            onChange={(value) => onChange(item.pane.key, value)}
            onSendToTerminal={() => onSendToTerminal(item.pane.key)}
            onActivate={() => onActivate(item.pane.key)}
            onOpenTip={(tip) => onOpenTip(item.pane.key, tip)}
            onClose={() => onClose(item.pane.key)}
            registerFocus={registerFocus}
            slashPhrases={slashPhrases}
          />
        ))}
      </div>
    </div>
  );
}
