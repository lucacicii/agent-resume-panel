import { useI18n } from "../i18n";

export function StartupMask(): React.JSX.Element | null {
  const { ready } = useI18n();
  if (ready) return null;
  return <div className="app-startup-mask" aria-live="polite" aria-busy="true" />;
}
