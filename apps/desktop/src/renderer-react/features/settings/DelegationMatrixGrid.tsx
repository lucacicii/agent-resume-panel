import { useCallback, useState, type JSX } from "react";
import { isBuiltinTemplateId, isProjectRoleTemplateId, type ImRoleTemplate } from "../../../shared/imTypes";
import { roleColor, roleInitial, type Translate } from "../im/imUtils";
import { ThemeIcon } from "../../components/ThemeIcon";

interface DelegationMatrixGridProps {
  templates: ImRoleTemplate[];
  t: Translate;
  onUpdateTemplate: (input: {
    templateId: string;
    callableTemplateIds?: string[];
    autoDispatch?: boolean;
  }) => Promise<void>;
}

export function DelegationMatrixGrid({
  templates,
  t,
  onUpdateTemplate
}: DelegationMatrixGridProps): JSX.Element {
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const toggleConnection = useCallback(
    async (caller: ImRoleTemplate, targetTemplateId: string) => {
      const currentCallables = new Set(caller.callableTemplateIds ?? []);
      if (currentCallables.has(targetTemplateId)) {
        currentCallables.delete(targetTemplateId);
      } else {
        currentCallables.add(targetTemplateId);
      }
      const key = `${caller.templateId}->${targetTemplateId}`;
      setSavingKey(key);
      try {
        await onUpdateTemplate({
          templateId: caller.templateId,
          callableTemplateIds: [...currentCallables]
        });
      } finally {
        setSavingKey(null);
      }
    },
    [onUpdateTemplate]
  );

  const toggleAutoDispatch = useCallback(
    async (caller: ImRoleTemplate) => {
      const nextAutoDispatch = !caller.autoDispatch;
      setSavingKey(`${caller.templateId}:auto`);
      try {
        await onUpdateTemplate({
          templateId: caller.templateId,
          autoDispatch: nextAutoDispatch
        });
      } finally {
        setSavingKey(null);
      }
    },
    [onUpdateTemplate]
  );

  const toggleAllForCaller = useCallback(
    async (caller: ImRoleTemplate, enableAll: boolean) => {
      const nextCallables = enableAll
        ? templates.filter((t) => t.templateId !== caller.templateId).map((t) => t.templateId)
        : [];
      setSavingKey(`${caller.templateId}:all`);
      try {
        await onUpdateTemplate({
          templateId: caller.templateId,
          callableTemplateIds: nextCallables
        });
      } finally {
        setSavingKey(null);
      }
    },
    [onUpdateTemplate, templates]
  );

  return (
    <div className="delegation-matrix-container">
      <div className="delegation-matrix-header-bar">
        <div className="delegation-matrix-legend">
          <span className="legend-item">
            <span className="legend-badge is-active">✓</span>
            <span>{t("desktop.settings.imDelegationApproveFirst", "Approve & Dispatch")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-badge is-auto">⚡</span>
            <span>{t("desktop.settings.imDelegationAuto", "Auto-Dispatch")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-badge is-disabled">-</span>
            <span>{t("desktop.settings.imDelegationDisabled", "Disabled")}</span>
          </span>
        </div>
      </div>

      <div className="delegation-matrix-table-wrap">
        <table className="delegation-matrix-table">
          <thead>
            <tr>
              <th className="matrix-corner-cell">
                <span className="matrix-axis-caller">{t("desktop.settings.imCallerRole", "Caller / From")} ↓</span>
                <span className="matrix-axis-callee">{t("desktop.settings.imCalleeRole", "Callee / To")} →</span>
              </th>
              <th className="matrix-th-auto-dispatch" title={t("desktop.settings.imAutoDispatchHeaderHint", "Enable auto-dispatch for caller")}>
                ⚡ {t("desktop.settings.imAutoDispatchShort", "Auto")}
              </th>
              <th className="matrix-th-actions">
                {t("desktop.settings.imBatchActions", "Quick")}
              </th>
              {templates.map((callee) => {
                const color = roleColor(callee.templateId);
                const isProject = callee.source === "project" || isProjectRoleTemplateId(callee.templateId);
                return (
                  <th key={callee.templateId} className="matrix-callee-th" title={callee.name}>
                    <div className="matrix-role-header">
                      <span className="im-role-avatar tiny" style={{ "--im-role-color": color } as any}>
                        {roleInitial(callee.name)}
                      </span>
                      <span className="matrix-role-name">{callee.name}</span>
                      {isProject && <span className="matrix-badge-repo">Repo</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {templates.map((caller) => {
              const callerColor = roleColor(caller.templateId);
              const callables = new Set(caller.callableTemplateIds ?? []);
              const isCallerProject = caller.source === "project" || isProjectRoleTemplateId(caller.templateId);
              const isCallerBuiltin = isBuiltinTemplateId(caller.templateId);
              const allActive = templates
                .filter((t) => t.templateId !== caller.templateId)
                .every((t) => callables.has(t.templateId));

              return (
                <tr key={caller.templateId}>
                  <td className="matrix-caller-td">
                    <div className="matrix-caller-label">
                      <span className="im-role-avatar tiny" style={{ "--im-role-color": callerColor } as any}>
                        {roleInitial(caller.name)}
                      </span>
                      <strong className="matrix-caller-name">{caller.name}</strong>
                      {isCallerProject && <span className="matrix-badge-repo">Repo</span>}
                      {isCallerBuiltin && <span className="matrix-badge-builtin">{t("desktop.settings.imBuiltin", "Builtin")}</span>}
                    </div>
                  </td>
                  <td className="matrix-auto-dispatch-td">
                    <button
                      type="button"
                      className={`matrix-auto-dispatch-btn${caller.autoDispatch ? " is-active" : ""}`}
                      onClick={() => void toggleAutoDispatch(caller)}
                      title={t("desktop.settings.imAutoDispatchToggle", "Toggle Auto-Dispatch")}
                    >
                      {caller.autoDispatch ? "⚡" : "○"}
                    </button>
                  </td>
                  <td className="matrix-actions-td">
                    <button
                      type="button"
                      className="ghost-btn tiny"
                      onClick={() => void toggleAllForCaller(caller, !allActive)}
                      title={allActive ? t("desktop.common.clear", "Clear") : t("desktop.common.selectAll", "Select All")}
                    >
                      {allActive ? t("desktop.common.clear", "Clear") : t("desktop.common.all", "All")}
                    </button>
                  </td>
                  {templates.map((callee) => {
                    const isSelf = caller.templateId === callee.templateId;
                    const isConnected = callables.has(callee.templateId);
                    const isSaving = savingKey === `${caller.templateId}->${callee.templateId}`;

                    if (isSelf) {
                      return (
                        <td key={callee.templateId} className="matrix-cell is-self">
                          <span className="matrix-self-marker" title={t("desktop.settings.imSelfDelegationDisabled", "Self-delegation not supported")}>-</span>
                        </td>
                      );
                    }

                    return (
                      <td key={callee.templateId} className={`matrix-cell${isConnected ? " is-connected" : ""}`}>
                        <button
                          type="button"
                          disabled={isSaving}
                          className={`matrix-toggle-btn${isConnected ? " is-checked" : ""}${caller.autoDispatch && isConnected ? " is-auto" : ""}`}
                          onClick={() => void toggleConnection(caller, callee.templateId)}
                          title={`${caller.name} → ${callee.name}: ${
                            isConnected
                              ? caller.autoDispatch
                                ? t("desktop.settings.imDelegationAuto", "Auto-Dispatch")
                                : t("desktop.settings.imDelegationApproveFirst", "Approve & Dispatch")
                              : t("desktop.settings.imDelegationDisabled", "Disabled")
                          }`}
                        >
                          {isConnected ? (caller.autoDispatch ? "⚡" : "✓") : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
