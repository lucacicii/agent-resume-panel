import type { SessionDotStatus } from "./sessionStatus";
import type { WorkbenchComposerSlashPhrase } from "@agent-resume/core";
import {
  TerminalComposer,
  type TerminalComposerPane
} from "./TerminalComposer";
import {
  tuiSlashCommandsForProvider,
  type TuiSlashCommand
} from "./tuiSlashCommands";

export type TerminalComposerStackItem = {
  pane: TerminalComposerPane;
  ptyId: number | null;
  activePane: boolean;
  value: string;
  provider?: string;
  projectName?: string;
  sessionTitle?: string;
  status?: SessionDotStatus;
};

export function TerminalComposerStack(props: {
  items: TerminalComposerStackItem[];
  onChange: (paneKey: string, value: string) => void;
  onSendToTerminal: (paneKey: string) => void;
  onRunSlashCommand?: (paneKey: string, command: TuiSlashCommand, args?: string) => void;
  onActivate?: (paneKey: string) => void;
  onClose?: (paneKey: string) => void;
  registerFocus: (key: string, focus: (options?: { caret?: "end" }) => void) => () => void;
  slashPhrases?: WorkbenchComposerSlashPhrase[];
}): React.JSX.Element | null {
  const { items, onChange, onSendToTerminal, onRunSlashCommand, onActivate, onClose, registerFocus, slashPhrases = [] } = props;
  const item = items.find((entry) => entry.activePane) ?? items[0];
  if (!item) return null;

  return (
    <div className="wb-terminal-composer-stack">
      <div className="wb-terminal-composer-stack-list">
        <TerminalComposer
          key={item.pane.key}
          pane={item.pane}
          ptyId={item.ptyId}
          activePane={item.activePane}
          projectName={item.projectName}
          sessionTitle={item.sessionTitle}
          status={item.status}
          value={item.value}
          onChange={(value) => onChange(item.pane.key, value)}
          onSendToTerminal={() => onSendToTerminal(item.pane.key)}
          onRunSlashCommand={onRunSlashCommand ? (command, args) => onRunSlashCommand(item.pane.key, command, args) : undefined}
          onActivate={() => onActivate?.(item.pane.key)}
          onClose={() => onClose?.(item.pane.key)}
          registerFocus={registerFocus}
          slashPhrases={slashPhrases}
          tuiSlashCommands={tuiSlashCommandsForProvider(item.provider)}
        />
      </div>
    </div>
  );
}
