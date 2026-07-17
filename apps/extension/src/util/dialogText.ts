import { AgentProvider } from "../history";
import { t } from "../i18n";

const MAX_SESSION_TITLE_IN_DIALOG = 48;

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function removeFromPanelConfirmMessage(session: {
  title: string;
  provider: AgentProvider;
}): string {
  const title = truncateText(session.title, MAX_SESSION_TITLE_IN_DIALOG);
  return t("dialog.removeFromPanelConfirm", title, session.provider);
}