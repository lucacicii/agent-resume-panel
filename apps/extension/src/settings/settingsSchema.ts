import { t } from "../i18n";
import { OUTPUT_LANGUAGE_AUTO, OUTPUT_LANGUAGE_OPTIONS } from "../i18n/locales";
import { getOutputLanguageOptionLabel, getUiLanguageOptionLabel } from "../i18n";
import { UI_LANGUAGE_OPTIONS } from "../i18n/locales";

export type SettingFieldType = "string" | "number" | "boolean" | "enum" | "stringArray";

export interface SettingField {
  key: string;
  label: string;
  description: string;
  type: SettingFieldType;
  default: string | number | boolean | string[];
  enum?: string[];
  enumLabels?: Record<string, string>;
  minimum?: number;
  maximum?: number;
}

export interface SettingGroup {
  id: string;
  title: string;
  description?: string;
  fields: SettingField[];
}

export interface SettingSection {
  id: string;
  title: string;
  description?: string;
  fields?: SettingField[];
  groups?: SettingGroup[];
}

export function getSectionFields(section: SettingSection): SettingField[] {
  if (section.groups?.length) {
    return section.groups.flatMap((group) => group.fields);
  }
  return section.fields ?? [];
}

export function getSettingSections(): SettingSection[] {
  return [
    {
      id: "general",
      title: t("settings.sectionGeneralTitle"),
      fields: [
        {
          key: "uiLanguage",
          label: t("settings.fieldUiLanguageLabel"),
          description: t("settings.fieldUiLanguageDescription"),
          type: "enum",
          default: "auto",
          enum: [...UI_LANGUAGE_OPTIONS],
          enumLabels: Object.fromEntries(UI_LANGUAGE_OPTIONS.map((value) => [value, getUiLanguageOptionLabel(value)]))
        },
        {
          key: "maxItems",
          label: t("settings.fieldMaxItemsLabel"),
          description: t("settings.fieldMaxItemsDescription"),
          type: "number",
          default: 10000,
          minimum: 20,
          maximum: 50000
        },
        {
          key: "editorNewSessionProvider",
          label: t("settings.fieldEditorNewSessionProviderLabel"),
          description: t("settings.fieldEditorNewSessionProviderDescription"),
          type: "enum",
          default: "codex",
          enum: ["codex", "claude", "agy", "grok", "opencode", "pi"],
          enumLabels: {
            codex: t("settings.enum.editorNewSessionProviderCodex"),
            claude: t("settings.enum.editorNewSessionProviderClaude"),
            agy: t("settings.enum.editorNewSessionProviderAgy"),
            grok: t("settings.enum.editorNewSessionProviderGrok"),
            opencode: t("settings.enum.editorNewSessionProviderOpencode"),
            pi: t("settings.enum.editorNewSessionProviderPi")
          }
        }
      ]
    },
    {
      id: "catalog",
      title: t("settings.sectionCatalogTitle"),
      description: t("settings.sectionCatalogDescription"),
      fields: [
        {
          key: "catalog.dbPath",
          label: t("settings.fieldCatalogDbPathLabel"),
          description: t("settings.fieldCatalogDbPathDescription"),
          type: "string",
          default: ""
        },
        {
          key: "catalog.syncMaxItems",
          label: t("settings.fieldCatalogSyncMaxItemsLabel"),
          description: t("settings.fieldCatalogSyncMaxItemsDescription"),
          type: "number",
          default: 10000,
          minimum: 500,
          maximum: 50000
        },
        {
          key: "catalog.stalePolicy",
          label: t("settings.fieldCatalogStalePolicyLabel"),
          description: t("settings.fieldCatalogStalePolicyDescription"),
          type: "enum",
          default: "off",
          enum: ["off", "purge"],
          enumLabels: {
            off: t("settings.enum.catalogStalePolicyOff"),
            purge: t("settings.enum.catalogStalePolicyPurge")
          }
        },
        {
          key: "catalog.sidebarMode",
          label: t("settings.fieldCatalogSidebarModeLabel"),
          description: t("settings.fieldCatalogSidebarModeDescription"),
          type: "enum",
          default: "legacy",
          enum: ["legacy", "full"],
          enumLabels: {
            legacy: t("settings.enum.catalogSidebarModeLegacy"),
            full: t("settings.enum.catalogSidebarModeFull")
          }
        }
      ]
    },
    {
      id: "dataPaths",
      title: t("settings.sectionDataPathsTitle"),
      fields: [
        {
          key: "codexHome",
          label: t("settings.fieldCodexHomeLabel"),
          description: t("settings.fieldCodexHomeDescription"),
          type: "string",
          default: "~/.codex"
        },
        {
          key: "claudeHome",
          label: t("settings.fieldClaudeHomeLabel"),
          description: t("settings.fieldClaudeHomeDescription"),
          type: "string",
          default: "~/.claude"
        },
        {
          key: "antigravityHome",
          label: t("settings.fieldAntigravityHomeLabel"),
          description: t("settings.fieldAntigravityHomeDescription"),
          type: "string",
          default: "~/.gemini"
        },
        {
          key: "grokHome",
          label: t("settings.fieldGrokHomeLabel"),
          description: t("settings.fieldGrokHomeDescription"),
          type: "string",
          default: "~/.grok"
        },
        {
          key: "opencodeHome",
          label: t("settings.fieldOpencodeHomeLabel"),
          description: t("settings.fieldOpencodeHomeDescription"),
          type: "string",
          default: "~/.local/share/opencode"
        },
        {
          key: "piHome",
          label: t("settings.fieldPiHomeLabel"),
          description: t("settings.fieldPiHomeDescription"),
          type: "string",
          default: "~/.pi/agent"
        }
      ]
    },
    {
      id: "filters",
      title: t("settings.sectionFiltersTitle"),
      fields: [
        {
          key: "showArchivedCodex",
          label: t("settings.fieldShowArchivedCodexLabel"),
          description: t("settings.fieldShowArchivedCodexDescription"),
          type: "boolean",
          default: false
        },
        {
          key: "showSubagentCodex",
          label: t("settings.fieldShowSubagentCodexLabel"),
          description: t("settings.fieldShowSubagentCodexDescription"),
          type: "boolean",
          default: false
        },
        {
          key: "showArchivedOpenCode",
          label: t("settings.fieldShowArchivedOpenCodeLabel"),
          description: t("settings.fieldShowArchivedOpenCodeDescription"),
          type: "boolean",
          default: false
        },
        {
          key: "showSubagentGrok",
          label: t("settings.fieldShowSubagentGrokLabel"),
          description: t("settings.fieldShowSubagentGrokDescription"),
          type: "boolean",
          default: false
        }
      ]
    },
    {
      id: "resume",
      title: t("settings.sectionResumeTitle"),
      fields: [
        {
          key: "claudeResumeMode",
          label: t("settings.fieldClaudeResumeModeLabel"),
          description: t("settings.fieldClaudeResumeModeDescription"),
          type: "enum",
          default: "panel",
          enum: ["terminal", "panel"],
          enumLabels: {
            terminal: t("settings.enum.claudeResumeModeTerminal"),
            panel: t("settings.enum.claudeResumeModePanel")
          }
        },
        {
          key: "codexResumeMode",
          label: t("settings.fieldCodexResumeModeLabel"),
          description: t("settings.fieldCodexResumeModeDescription"),
          type: "enum",
          default: "terminal",
          enum: ["terminal", "panel", "app"],
          enumLabels: {
            terminal: t("settings.enum.codexResumeModeTerminal"),
            panel: t("settings.enum.codexResumeModePanel"),
            app: t("settings.enum.codexResumeModeApp")
          }
        },
        {
          key: "codexIdePanelResume.enabled",
          label: t("settings.fieldCodexIdePanelResumeEnabledLabel"),
          description: t("settings.fieldCodexIdePanelResumeEnabledDescription"),
          type: "boolean",
          default: true
        },
        {
          key: "codexIdePanelResume.implementationVersion",
          label: t("settings.fieldCodexIdePanelResumeImplementationVersionLabel"),
          description: t("settings.fieldCodexIdePanelResumeImplementationVersionDescription"),
          type: "number",
          default: 1,
          minimum: 1,
          maximum: 99
        }
      ]
    },
    {
      id: "terminal",
      title: t("settings.sectionTerminalTitle"),
      fields: [
        {
          key: "terminalMode",
          label: t("settings.fieldTerminalModeLabel"),
          description: t("settings.fieldTerminalModeDescription"),
          type: "enum",
          default: "newPerSession",
          enum: ["newPerSession"],
          enumLabels: {
            newPerSession: t("settings.enum.terminalModeNewPerSession")
          }
        },
        {
          key: "terminalLocation",
          label: t("settings.fieldTerminalLocationLabel"),
          description: t("settings.fieldTerminalLocationDescription"),
          type: "enum",
          default: "editorBeside",
          enum: ["editorBeside", "panel"],
          enumLabels: {
            editorBeside: t("settings.enum.terminalLocationEditorBeside"),
            panel: t("settings.enum.terminalLocationPanel")
          }
        },
        {
          key: "enableVsCodeTerminalImagesHint",
          label: t("settings.fieldEnableVsCodeTerminalImagesHintLabel"),
          description: t("settings.fieldEnableVsCodeTerminalImagesHintDescription"),
          type: "boolean",
          default: true
        },
        {
          key: "ghosttyExecutable",
          label: t("settings.fieldGhosttyExecutableLabel"),
          description: t("settings.fieldGhosttyExecutableDescription"),
          type: "string",
          default: "Ghostty"
        },
        {
          key: "ghosttyLaunchMode",
          label: t("settings.fieldGhosttyLaunchModeLabel"),
          description: t("settings.fieldGhosttyLaunchModeDescription"),
          type: "enum",
          default: "pasteCommand",
          enum: ["pasteCommand", "copyCommand", "executeCommand"],
          enumLabels: {
            pasteCommand: t("settings.enum.ghosttyLaunchModePasteCommand"),
            copyCommand: t("settings.enum.ghosttyLaunchModeCopyCommand"),
            executeCommand: t("settings.enum.ghosttyLaunchModeExecuteCommand")
          }
        },
        {
          key: "ghosttyAutoPasteDelayMs",
          label: t("settings.fieldGhosttyAutoPasteDelayMsLabel"),
          description: t("settings.fieldGhosttyAutoPasteDelayMsDescription"),
          type: "number",
          default: 900,
          minimum: 100,
          maximum: 5000
        }
      ]
    },
    {
      id: "acp",
      title: t("settings.sectionAcpTitle"),
      description: t("settings.sectionAcpDescription"),
      groups: [
        {
          id: "general",
          title: t("settings.groupAcpGeneralTitle"),
          fields: [
            {
              key: "panelHome",
              label: t("settings.fieldPanelHomeLabel"),
              description: t("settings.fieldPanelHomeDescription"),
              type: "string",
              default: "~/.agent-resume-panel"
            },
            {
              key: "acp.autoApprovePermissions",
              label: t("settings.fieldAcpAutoApprovePermissionsLabel"),
              description: t("settings.fieldAcpAutoApprovePermissionsDescription"),
              type: "enum",
              default: "ask",
              enum: ["ask", "allowAll"],
              enumLabels: {
                ask: t("settings.enum.acpAutoApprovePermissionsAsk"),
                allowAll: t("settings.enum.acpAutoApprovePermissionsAllowAll")
              }
            }
          ]
        },
        {
          id: "codex",
          title: t("settings.groupAcpCodexTitle"),
          fields: [
            {
              key: "acp.agents.codex.command",
              label: t("settings.fieldAcpLaunchCommandLabel"),
              description: t("settings.fieldAcpCodexLaunchCommandDescription"),
              type: "string",
              default: "npx"
            },
            {
              key: "acp.agents.codex.args",
              label: t("settings.fieldAcpLaunchArgsLabel"),
              description: t("settings.fieldAcpCodexLaunchArgsDescription"),
              type: "stringArray",
              default: ["-y", "@zed-industries/codex-acp@latest"]
            }
          ]
        },
        {
          id: "claude",
          title: t("settings.groupAcpClaudeTitle"),
          fields: [
            {
              key: "acp.agents.claude.command",
              label: t("settings.fieldAcpLaunchCommandLabel"),
              description: t("settings.fieldAcpClaudeLaunchCommandDescription"),
              type: "string",
              default: "npx"
            },
            {
              key: "acp.agents.claude.args",
              label: t("settings.fieldAcpLaunchArgsLabel"),
              description: t("settings.fieldAcpClaudeLaunchArgsDescription"),
              type: "stringArray",
              default: ["-y", "@agentclientprotocol/claude-agent-acp@latest"]
            }
          ]
        },
        {
          id: "grok",
          title: t("settings.groupAcpGrokTitle"),
          description: t("settings.groupAcpGrokDescription"),
          fields: [
            {
              key: "acp.agents.grok.command",
              label: t("settings.fieldAcpLaunchCommandLabel"),
              description: t("settings.fieldAcpGrokLaunchCommandDescription"),
              type: "string",
              default: "grok"
            },
            {
              key: "acp.agents.grok.args",
              label: t("settings.fieldAcpLaunchArgsLabel"),
              description: t("settings.fieldAcpGrokLaunchArgsDescription"),
              type: "stringArray",
              default: ["agent", "stdio"]
            }
          ]
        },
        {
          id: "opencode",
          title: t("settings.groupAcpOpenCodeTitle"),
          fields: [
            {
              key: "acp.agents.opencode.command",
              label: t("settings.fieldAcpLaunchCommandLabel"),
              description: t("settings.fieldAcpOpenCodeLaunchCommandDescription"),
              type: "string",
              default: "npx"
            },
            {
              key: "acp.agents.opencode.args",
              label: t("settings.fieldAcpLaunchArgsLabel"),
              description: t("settings.fieldAcpOpenCodeLaunchArgsDescription"),
              type: "stringArray",
              default: ["-y", "opencode-ai@latest", "acp"]
            }
          ]
        },
        {
          id: "pi",
          title: t("settings.groupAcpPiTitle"),
          fields: [
            {
              key: "acp.agents.pi.command",
              label: t("settings.fieldAcpLaunchCommandLabel"),
              description: t("settings.fieldAcpPiLaunchCommandDescription"),
              type: "string",
              default: "npx"
            },
            {
              key: "acp.agents.pi.args",
              label: t("settings.fieldAcpLaunchArgsLabel"),
              description: t("settings.fieldAcpPiLaunchArgsDescription"),
              type: "stringArray",
              default: ["-y", "pi-acp"]
            }
          ]
        }
      ]
    },
    {
      id: "llm",
      title: t("settings.sectionLlmTitle"),
      description: t("settings.sectionLlmDescription"),
      fields: [
        {
          key: "llm.baseUrl",
          label: t("settings.fieldLlmBaseUrlLabel"),
          description: t("settings.fieldLlmBaseUrlDescription"),
          type: "string",
          default: "https://api.openai.com/v1"
        },
        {
          key: "llm.model",
          label: t("settings.fieldLlmModelLabel"),
          description: t("settings.fieldLlmModelDescription"),
          type: "string",
          default: "gpt-4o-mini"
        },
        {
          key: "llm.outputLanguage",
          label: t("settings.fieldLlmOutputLanguageLabel"),
          description: t("settings.fieldLlmOutputLanguageDescription"),
          type: "enum",
          default: OUTPUT_LANGUAGE_AUTO,
          enum: [...OUTPUT_LANGUAGE_OPTIONS],
          enumLabels: Object.fromEntries(
            OUTPUT_LANGUAGE_OPTIONS.map((value) => [value, getOutputLanguageOptionLabel(value)])
          )
        },
        {
          key: "llm.maxContextChars",
          label: t("settings.fieldLlmMaxContextCharsLabel"),
          description: t("settings.fieldLlmMaxContextCharsDescription"),
          type: "number",
          default: 120000,
          minimum: 1000,
          maximum: 500000
        }
      ]
    },
    {
      id: "handoff",
      title: t("settings.sectionHandoffTitle"),
      description: t("settings.sectionHandoffDescription"),
      fields: [
        {
          key: "handoff.attachRecentVerbatim",
          label: t("settings.fieldHandoffAttachRecentVerbatimLabel"),
          description: t("settings.fieldHandoffAttachRecentVerbatimDescription"),
          type: "number",
          default: 5,
          minimum: 0,
          maximum: 20
        },
        {
          key: "handoff.maxBriefTokens",
          label: t("settings.fieldHandoffMaxBriefTokensLabel"),
          description: t("settings.fieldHandoffMaxBriefTokensDescription"),
          type: "number",
          default: 2500,
          minimum: 500,
          maximum: 8000
        }
      ]
    }
  ];
}

export function findSettingField(key: string): SettingField | undefined {
  for (const section of getSettingSections()) {
    const field = getSectionFields(section).find((entry) => entry.key === key);
    if (field) {
      return field;
    }
  }
  return undefined;
}

export const LLM_API_KEY_SECRET = "agentResume.llm.apiKey";

export function getAllSettingKeys(): string[] {
  return getSettingSections().flatMap((section) => getSectionFields(section).map((field) => field.key));
}