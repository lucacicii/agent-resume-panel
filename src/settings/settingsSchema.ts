import { DEFAULT_LLM_OUTPUT_LANGUAGE, LLM_OUTPUT_LANGUAGES } from "../llm/languages";

export type SettingFieldType = "string" | "number" | "boolean" | "enum" | "stringArray";

export interface SettingField {
  key: string;
  label: string;
  description: string;
  type: SettingFieldType;
  default: string | number | boolean | string[];
  enum?: string[];
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

export function findSettingField(key: string): SettingField | undefined {
  for (const section of SETTING_SECTIONS) {
    const field = getSectionFields(section).find((entry) => entry.key === key);
    if (field) {
      return field;
    }
  }
  return undefined;
}

export const LLM_API_KEY_SECRET = "agentResume.llm.apiKey";

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: "general",
    title: "General",
    fields: [
      {
        key: "maxItems",
        label: "Max Sessions",
        description: "Maximum number of sessions to load into the panel.",
        type: "number",
        default: 500,
        minimum: 20,
        maximum: 5000
      },
      {
        key: "editorNewSessionProvider",
        label: "Editor New Session Provider",
        description: "Agent provider started by the editor title bar New Session button.",
        type: "enum",
        default: "codex",
        enum: ["codex", "claude", "agy", "grok", "opencode", "pi"]
      }
    ]
  },
  {
    id: "dataPaths",
    title: "Data Paths",
    fields: [
      {
        key: "codexHome",
        label: "Codex Home",
        description: "Codex home directory containing state_*.sqlite, session_index.jsonl, and history.jsonl.",
        type: "string",
        default: "~/.codex"
      },
      {
        key: "claudeHome",
        label: "Claude Home",
        description: "Claude Code home directory containing history.jsonl and projects.",
        type: "string",
        default: "~/.claude"
      },
      {
        key: "antigravityHome",
        label: "Antigravity Home",
        description: "Antigravity data root. The extension scans antigravity-cli and antigravity subdirectories for sessions.",
        type: "string",
        default: "~/.gemini"
      },
      {
        key: "grokHome",
        label: "Grok Home",
        description: "Grok Build home directory containing sessions.",
        type: "string",
        default: "~/.grok"
      },
      {
        key: "almaDataDir",
        label: "Alma Data Dir",
        description: "Alma data directory containing chat_threads.db.",
        type: "string",
        default: "~/Library/Application Support/alma"
      },
      {
        key: "opencodeHome",
        label: "OpenCode Home",
        description: "OpenCode data directory containing opencode.db.",
        type: "string",
        default: "~/.local/share/opencode"
      },
      {
        key: "piHome",
        label: "Pi Home",
        description: "Pi agent home directory containing sessions.",
        type: "string",
        default: "~/.pi/agent"
      }
    ]
  },
  {
    id: "filters",
    title: "Session Filters",
    fields: [
      {
        key: "showArchivedCodex",
        label: "Show Archived Codex",
        description: "Show archived Codex threads.",
        type: "boolean",
        default: false
      },
      {
        key: "showSubagentCodex",
        label: "Show Codex Subagents",
        description: "Show Codex subagent threads in the panel.",
        type: "boolean",
        default: false
      },
      {
        key: "showArchivedOpenCode",
        label: "Show Archived OpenCode",
        description: "Show archived OpenCode sessions.",
        type: "boolean",
        default: false
      },
      {
        key: "showSubagentGrok",
        label: "Show Grok Subagents",
        description: "Show Grok Build subagent sessions in the panel.",
        type: "boolean",
        default: false
      },
      {
        key: "hideCronAlma",
        label: "Hide Alma Cron",
        description: "Hide Alma cron threads (titles starting with Cron:).",
        type: "boolean",
        default: true
      },
      {
        key: "hideChannelAlma",
        label: "Hide Alma Channels",
        description: "Hide Alma channel threads (WeChat, Telegram, Discord, Slack).",
        type: "boolean",
        default: true
      },
      {
        key: "showIncognitoAlma",
        label: "Show Alma Incognito",
        description: "Show Alma incognito threads in the panel.",
        type: "boolean",
        default: false
      }
    ]
  },
  {
    id: "resume",
    title: "Resume Behavior",
    fields: [
      {
        key: "claudeResumeMode",
        label: "Claude Resume Mode",
        description: "How Claude sessions resume from a click or Open Folder and Resume.",
        type: "enum",
        default: "panel",
        enum: ["terminal", "panel"]
      },
      {
        key: "codexResumeMode",
        label: "Codex Resume Mode",
        description: "How Codex sessions resume from a click or Open Folder and Resume.",
        type: "enum",
        default: "terminal",
        enum: ["terminal", "panel", "app"]
      },
      {
        key: "codexIdePanelResume.enabled",
        label: "Codex IDE Panel Resume",
        description: "[Experimental] Enable Resume in Codex IDE Panel.",
        type: "boolean",
        default: true
      },
      {
        key: "codexIdePanelResume.implementationVersion",
        label: "Codex IDE Panel Version",
        description: "Must match the Codex IDE panel integration version built into Agent Resume Panel.",
        type: "number",
        default: 1,
        minimum: 1,
        maximum: 99
      }
    ]
  },
  {
    id: "terminal",
    title: "Terminal & Ghostty",
    fields: [
      {
        key: "terminalMode",
        label: "Terminal Mode",
        description: "Terminal launch behavior.",
        type: "enum",
        default: "newPerSession",
        enum: ["newPerSession"]
      },
      {
        key: "terminalLocation",
        label: "Terminal Location",
        description: "Where VS Code integrated resume terminals should open.",
        type: "enum",
        default: "editorBeside",
        enum: ["editorBeside", "panel"]
      },
      {
        key: "enableVsCodeTerminalImagesHint",
        label: "Terminal Images Hint",
        description: "Show a one-time hint about VS Code terminal image support and the Ghostty fallback.",
        type: "boolean",
        default: true
      },
      {
        key: "ghosttyExecutable",
        label: "Ghostty Executable",
        description: "Ghostty app name on macOS or ghostty CLI executable/path used by Open in Ghostty.",
        type: "string",
        default: "Ghostty"
      },
      {
        key: "ghosttyLaunchMode",
        label: "Ghostty Launch Mode",
        description: "How Open in Ghostty starts a session.",
        type: "enum",
        default: "pasteCommand",
        enum: ["pasteCommand", "copyCommand", "executeCommand"]
      },
      {
        key: "ghosttyAutoPasteDelayMs",
        label: "Ghostty Auto-Paste Delay (ms)",
        description: "Delay before auto-pasting the resume command into Ghostty when ghosttyLaunchMode is pasteCommand.",
        type: "number",
        default: 900,
        minimum: 100,
        maximum: 5000
      }
    ]
  },
  {
    id: "acp",
    title: "ACP Chat",
    description: "In-editor ACP chat panel launch configuration.",
    groups: [
      {
        id: "general",
        title: "General",
        fields: [
          {
            key: "panelHome",
            label: "ACP Data Directory",
            description: "Directory for ACP Chat session data (default ~/.agent-resume-panel).",
            type: "string",
            default: "~/.agent-resume-panel"
          },
          {
            key: "acp.autoApprovePermissions",
            label: "Permission Handling",
            description: "How ACP Chat handles agent permission requests.",
            type: "enum",
            default: "ask",
            enum: ["ask", "allowAll"]
          }
        ]
      },
      {
        id: "codex",
        title: "Codex",
        fields: [
          {
            key: "acp.agents.codex.command",
            label: "Launch Command",
            description: "Command used to start the Codex ACP agent.",
            type: "string",
            default: "npx"
          },
          {
            key: "acp.agents.codex.args",
            label: "Launch Args",
            description: "Arguments for the Codex ACP agent (one per line).",
            type: "stringArray",
            default: ["-y", "@zed-industries/codex-acp@latest"]
          }
        ]
      },
      {
        id: "claude",
        title: "Claude",
        fields: [
          {
            key: "acp.agents.claude.command",
            label: "Launch Command",
            description: "Command used to start the Claude ACP agent.",
            type: "string",
            default: "npx"
          },
          {
            key: "acp.agents.claude.args",
            label: "Launch Args",
            description: "Arguments for the Claude ACP agent (one per line).",
            type: "stringArray",
            default: ["-y", "@agentclientprotocol/claude-agent-acp@latest"]
          }
        ]
      },
      {
        id: "grok",
        title: "Grok Build",
        description:
          "Uses the locally installed grok CLI by default (https://x.ai/cli). Do not use @xai-official/grok@latest — npm latest points at 0.1.x without agent stdio.",
        fields: [
          {
            key: "acp.agents.grok.command",
            label: "Launch Command",
            description: "Command used to start the Grok ACP agent.",
            type: "string",
            default: "grok"
          },
          {
            key: "acp.agents.grok.args",
            label: "Launch Args",
            description: "Arguments for the Grok ACP agent (one per line).",
            type: "stringArray",
            default: ["agent", "stdio"]
          }
        ]
      },
      {
        id: "opencode",
        title: "OpenCode",
        fields: [
          {
            key: "acp.agents.opencode.command",
            label: "Launch Command",
            description: "Command used to start the OpenCode ACP agent.",
            type: "string",
            default: "npx"
          },
          {
            key: "acp.agents.opencode.args",
            label: "Launch Args",
            description: "Arguments for the OpenCode ACP agent (one per line).",
            type: "stringArray",
            default: ["-y", "opencode-ai@latest", "acp"]
          }
        ]
      },
      {
        id: "pi",
        title: "Pi",
        fields: [
          {
            key: "acp.agents.pi.command",
            label: "Launch Command",
            description: "Command used to start the Pi ACP agent.",
            type: "string",
            default: "npx"
          },
          {
            key: "acp.agents.pi.args",
            label: "Launch Args",
            description: "Arguments for the Pi ACP agent (one per line).",
            type: "stringArray",
            default: ["-y", "pi-acp"]
          }
        ]
      }
    ]
  },
  {
    id: "llm",
    title: "LLM Assist",
    description:
      "OpenAI-compatible API for session summarize and auto-rename. Prefer a fast, low-cost model when possible.",
    fields: [
      {
        key: "llm.baseUrl",
        label: "API Base URL",
        description: "OpenAI-compatible API base URL (e.g. https://api.openai.com/v1).",
        type: "string",
        default: "https://api.openai.com/v1"
      },
      {
        key: "llm.model",
        label: "Model",
        description:
          "Model name for summarize and auto-rename. Use a fast, inexpensive model when possible (e.g. gpt-4o-mini, deepseek-chat).",
        type: "string",
        default: "gpt-4o-mini"
      },
      {
        key: "llm.outputLanguage",
        label: "Output Language",
        description: "Language used for Summarize and Auto Rename results.",
        type: "enum",
        default: DEFAULT_LLM_OUTPUT_LANGUAGE,
        enum: [...LLM_OUTPUT_LANGUAGES]
      },
      {
        key: "llm.maxContextChars",
        label: "Max Context Chars",
        description: "Maximum characters of conversation sent to the LLM.",
        type: "number",
        default: 120000,
        minimum: 1000,
        maximum: 500000
      }
    ]
  }
];

export function getAllSettingKeys(): string[] {
  return SETTING_SECTIONS.flatMap((section) => getSectionFields(section).map((field) => field.key));
}