/** Desktop-only settings strings for non-en/zh-cn locales (merged after catalog + aliases). */

const LOCALES = ["ja", "ko", "de", "es", "fr", "it", "pt-br", "ru"];

/** @param {...string} values One translation per locale in LOCALES order. */
function row(...values) {
  if (values.length !== LOCALES.length) {
    throw new Error(`Expected ${LOCALES.length} locale values, got ${values.length}`);
  }
  return Object.fromEntries(LOCALES.map((locale, index) => [locale, values[index]]));
}

/** @type {Record<string, Record<string, string>>} */
export const overridesByKey = {
  "desktop.settings.done": row("完了", "완료", "Fertig", "Listo", "Terminé", "Fine", "Concluído", "Готово"),
  "desktop.settings.navLabel": row(
    "設定メニュー",
    "설정 메뉴",
    "Einstellungsmenü",
    "Menú de configuración",
    "Menu des paramètres",
    "Menu impostazioni",
    "Menu de configurações",
    "Меню настроек"
  ),
  "desktop.settings.paneModels": row("モデル", "모델", "Modelle", "Modelos", "Modèles", "Modelli", "Modelos", "Модели"),
  "desktop.settings.paneWorkbench": row(
    "ワークベンチ",
    "워크벤치",
    "Workbench",
    "Workbench",
    "Workbench",
    "Workbench",
    "Workbench",
    "Workbench"
  ),
  "desktop.settings.paneReport": row("レポート", "보고서", "Bericht", "Informe", "Rapport", "Report", "Relatório", "Отчёт"),
  "desktop.tabs.report": row("レポート", "보고서", "Bericht", "Informe", "Rapport", "Report", "Relatório", "Отчёт"),
  "desktop.settings.paneUsage": row("使用量", "사용량", "Nutzung", "Uso", "Utilisation", "Utilizzo", "Uso", "Использование"),
  "desktop.settings.paneAbout": row("About", "About", "Über", "Acerca de", "À propos", "Informazioni", "Sobre", "О программе"),
  "desktop.settings.paneGeneralDesc": row(
    "外観と日常の設定",
    "외관 및 일상 설정",
    "Erscheinungsbild und tägliche Einstellungen",
    "Apariencia y preferencias diarias",
    "Apparence et préférences quotidiennes",
    "Aspetto e preferenze quotidiane",
    "Aparência e preferências diárias",
    "Внешний вид и ежедневные настройки"
  ),
  "desktop.settings.paneModelsDesc": row(
    "ツール LLM、チャット、Embedding",
    "도구 LLM, 채팅, Embedding",
    "Tool-LLM, Chat und Embedding",
    "LLM de herramientas, chat y embedding",
    "LLM outil, chat et embedding",
    "LLM strumento, chat ed embedding",
    "LLM de ferramentas, chat e embedding",
    "Инструментальный LLM, чат и embedding"
  ),
  "desktop.settings.paneSessionsDesc": row(
    "同期ポリシーとセッション一覧の表示",
    "동기화 정책 및 세션 목록 표시",
    "Synchronisierungsrichtlinie und Sichtbarkeit der Sitzungsliste",
    "Política de sincronización y visibilidad de la lista de sesiones",
    "Politique de synchronisation et visibilité de la liste des sessions",
    "Politica di sincronizzazione e visibilità dell'elenco sessioni",
    "Política de sincronização e visibilidade da lista de sessões",
    "Политика синхронизации и видимость списка сессий"
  ),
  "desktop.settings.paneWorkbenchDesc": row(
    "新規セッション、エディター、ターミナル",
    "새 세션, 편집기, 터미널",
    "Neue Sitzungen, Editor und Terminal",
    "Nuevas sesiones, editor y terminal",
    "Nouvelles sessions, éditeur et terminal",
    "Nuove sessioni, editor e terminale",
    "Novas sessões, editor e terminal",
    "Новые сессии, редактор и терминал"
  ),
  "desktop.settings.paneReportDesc": row(
    "定期 digest と履歴の一括生成",
    "예약 digest 및 기록 일괄 생성",
    "Geplante Digests und historisches Backfill",
    "Digests programados y relleno histórico",
    "Digests planifiés et remplissage historique",
    "Digest pianificati e backfill storico",
    "Digests agendados e preenchimento histórico",
    "Запланированные digest и историческое заполнение"
  ),
  "desktop.settings.paneStorageDesc": row(
    "Panel home、ノート、Agent データディレクトリ",
    "Panel home, 노트, Agent 데이터 디렉터리",
    "Panel-Home, Notizen und Agent-Datenverzeichnisse",
    "Panel home, notas y directorios de datos de agentes",
    "Panel home, notes et répertoires de données des agents",
    "Panel home, note e directory dati agent",
    "Panel home, notas e diretórios de dados de agentes",
    "Panel home, заметки и каталоги данных агентов"
  ),
  "desktop.settings.paneUsageDesc": row(
    "LLM 呼び出しと定期タスクの統計",
    "LLM 호출 및 예약 작업 통계",
    "LLM-Aufrufe und Statistik geplanter Aufgaben",
    "Llamadas LLM y estadísticas de tareas programadas",
    "Appels LLM et statistiques des tâches planifiées",
    "Chiamate LLM e statistiche attività pianificate",
    "Chamadas LLM e estatísticas de tarefas agendadas",
    "Вызовы LLM и статистика запланированных задач"
  ),
  "desktop.settings.paneAboutDesc": row(
    "ドキュメントとフィードバック",
    "문서 및 피드백",
    "Dokumentation und Feedback",
    "Documentación y comentarios",
    "Documentation et retours",
    "Documentazione e feedback",
    "Documentação e feedback",
    "Документация и обратная связь"
  ),
  "desktop.settings.appearance": row("外観", "외관", "Erscheinungsbild", "Apariencia", "Apparence", "Aspetto", "Aparência", "Внешний вид"),
  "desktop.settings.theme": row("テーマ", "테마", "Design", "Tema", "Thème", "Tema", "Tema", "Тема"),
  "desktop.settings.themeDesc": row(
    "ライト、ダーク、またはシステムに従う",
    "라이트, 다크 또는 시스템 따르기",
    "Hell, dunkel oder System folgen",
    "Claro, oscuro o seguir el sistema",
    "Clair, sombre ou suivre le système",
    "Chiaro, scuro o segui il sistema",
    "Claro, escuro ou seguir o sistema",
    "Светлая, тёмная или как в системе"
  ),
  "desktop.settings.themeSystem": row(
    "システムに従う",
    "시스템 따르기",
    "System folgen",
    "Seguir el sistema",
    "Suivre le système",
    "Segui il sistema",
    "Seguir o sistema",
    "Как в системе"
  ),
  "desktop.settings.themeLight": row("ライト", "라이트", "Hell", "Claro", "Clair", "Chiaro", "Claro", "Светлая"),
  "desktop.settings.themeDark": row("ダーク", "다크", "Dunkel", "Oscuro", "Sombre", "Scuro", "Escuro", "Тёмная"),
  "desktop.settings.chatModel": row("チャットモデル", "채팅 모델", "Chat-Modell", "Modelo de chat", "Modèle de chat", "Modello chat", "Modelo de chat", "Модель чата"),
  "desktop.settings.chatModelFootnote": row(
    "Ask / Meta-Agent チャット用。既定はツール LLM。より強いモデルも可。",
    "Ask / Meta-Agent 채팅용. 기본값은 도구 LLM. 더 강한 모델도 가능.",
    "Für Ask-/Meta-Agent-Chat. Standard ist Tool-LLM; stärkeres Modell möglich.",
    "Para chat Ask / Meta-Agent. Por defecto usa el LLM de herramientas; puede usar uno más potente.",
    "Pour le chat Ask / Meta-Agent. Par défaut le LLM outil ; un modèle plus puissant est possible.",
    "Per chat Ask / Meta-Agent. Predefinito: LLM strumento; puoi usare un modello più potente.",
    "Para chat Ask / Meta-Agent. Padrão: LLM de ferramentas; pode usar um modelo mais forte.",
    "Для чата Ask / Meta-Agent. По умолчанию инструментальный LLM; можно выбрать более мощную модель."
  ),
  "desktop.settings.embedding": row("Embedding", "Embedding", "Embedding", "Embedding", "Embedding", "Embedding", "Embedding", "Embedding"),
  "desktop.settings.embeddingFootnote": row(
    "Base URL / API Key は任意。未設定時はツール LLM の設定を使用。",
    "Base URL / API Key는 선택 사항. 비어 있으면 도구 LLM 설정을 사용합니다.",
    "Base URL / API Key optional; fällt sonst auf Tool-LLM-Einstellungen zurück.",
    "Base URL / API Key opcionales; si están vacíos, se usan los del LLM de herramientas.",
    "Base URL / API Key facultatifs ; sinon repli sur le LLM outil.",
    "Base URL / API Key opzionali; in assenza si usa l'LLM strumento.",
    "Base URL / API Key opcionais; se vazios, usa as do LLM de ferramentas.",
    "Base URL / API Key необязательны; иначе используются настройки инструментального LLM."
  ),
  "desktop.settings.baseUrlOptional": row(
    "Base URL（任意）",
    "Base URL(선택)",
    "Base URL (optional)",
    "Base URL (opcional)",
    "Base URL (facultatif)",
    "Base URL (opzionale)",
    "Base URL (opcional)",
    "Base URL (необязательно)"
  ),
  "desktop.settings.apiKeyOptional": row(
    "API Key（任意）",
    "API Key(선택)",
    "API Key (optional)",
    "API Key (opcional)",
    "API Key (facultative)",
    "API Key (opzionale)",
    "API Key (opcional)",
    "API Key (необязательно)"
  ),
  "desktop.settings.settingsPathFootnote": row(
    "~/.agent-resume-panel/settings.json に書き込み（VS Code 拡張と共有）。",
    "~/.agent-resume-panel/settings.json에 기록됩니다(VS Code 확장과 공유).",
    "Wird in ~/.agent-resume-panel/settings.json geschrieben (mit VS Code-Erweiterung geteilt).",
    "Se escribe en ~/.agent-resume-panel/settings.json (compartido con la extensión de VS Code).",
    "Écrit dans ~/.agent-resume-panel/settings.json (partagé avec l’extension VS Code).",
    "Scritto in ~/.agent-resume-panel/settings.json (condiviso con l’estensione VS Code).",
    "Gravado em ~/.agent-resume-panel/settings.json (compartilhado com a extensão VS Code).",
    "Записывается в ~/.agent-resume-panel/settings.json (общий с расширением VS Code)."
  ),
  "desktop.settings.sync": row("同期", "동기화", "Synchronisierung", "Sincronización", "Synchronisation", "Sincronizzazione", "Sincronização", "Синхронизация"),
  "desktop.settings.staleHide": row("非表示", "숨기기", "Ausblenden", "Ocultar", "Masquer", "Nascondi", "Ocultar", "Скрыть"),
  "desktop.settings.stalePurge": row("削除", "삭제", "Entfernen", "Eliminar", "Supprimer", "Elimina", "Remover", "Удалить"),
  "desktop.settings.visibilityFootnote": row(
    "各プロバイダーのアーカイブ／サブエージェント session の一覧表示を制御します。",
    "각 제공자의 보관/하위 에이전트 세션 목록 표시를 제어합니다.",
    "Steuert archivierte/Subagent-Sitzungen je Anbieter in Listen.",
    "Controla sesiones archivadas/subagente por proveedor en las listas.",
    "Contrôle les sessions archivées/sous-agents par fournisseur dans les listes.",
    "Controlla sessioni archiviate/sub-agent per provider negli elenchi.",
    "Controla sessões arquivadas/subagente por provedor nas listas.",
    "Управляет отображением архивных/субагентских сессий по провайдеру в списках."
  ),
  "desktop.settings.newSessionGroup": row(
    "新規 Session",
    "새 Session",
    "Neue Session",
    "Nueva sesión",
    "Nouvelle session",
    "Nuova session",
    "Nova sessão",
    "Новая session"
  ),
  "desktop.settings.scratchDir": row("一時ディレクトリ", "임시 디렉터리", "Temporäres Verzeichnis", "Directorio temporal", "Répertoire temporaire", "Directory temporanea", "Diretório temporário", "Временный каталог"),
  "desktop.settings.projectEditor": row("プロジェクトエディター", "프로젝트 편집기", "Projekt-Editor", "Editor de proyecto", "Éditeur de projet", "Editor di progetto", "Editor de projeto", "Редактор проекта"),
  "desktop.settings.projectEditorDesc": row(
    "ワークベンチからプロジェクトを開くときに使うエディター",
    "워크벤치에서 프로젝트를 열 때 사용하는 편집기",
    "Editor beim Öffnen eines Projekts aus dem Workbench",
    "Editor al abrir un proyecto desde Workbench",
    "Éditeur utilisé pour ouvrir un projet depuis Workbench",
    "Editor usato aprendo un progetto da Workbench",
    "Editor usado ao abrir um projeto no Workbench",
    "Редактор при открытии проекта из Workbench"
  ),
  "desktop.settings.editorAuto": row("自動検出", "자동 감지", "Automatisch erkennen", "Detección automática", "Détection automatique", "Rilevamento automatico", "Detecção automática", "Автоопределение"),
  "desktop.settings.terminalXterm": row(
    "内蔵ターミナル (xterm.js)",
    "내장 터미널 (xterm.js)",
    "Eingebettetes Terminal (xterm.js)",
    "Terminal integrado (xterm.js)",
    "Terminal intégré (xterm.js)",
    "Terminale integrato (xterm.js)",
    "Terminal integrado (xterm.js)",
    "Встроенный терминал (xterm.js)"
  ),
  "desktop.settings.terminalExternal": row(
    "システム既定のターミナル",
    "시스템 기본 터미널",
    "Systemstandard-Terminal",
    "Terminal predeterminado del sistema",
    "Terminal système par défaut",
    "Terminale predefinito di sistema",
    "Terminal padrão do sistema",
    "Терминал системы по умолчанию"
  ),
  "desktop.settings.launchExecute": row(
    "再開コマンドを自動実行",
    "재개 명령 자동 실행",
    "Resume-Befehl automatisch ausführen",
    "Ejecutar automáticamente el comando de reanudación",
    "Exécuter automatiquement la commande de reprise",
    "Esegui automaticamente il comando di ripresa",
    "Executar automaticamente o comando de retomada",
    "Автоматически выполнять команду возобновления"
  ),
  "desktop.settings.launchPaste": row(
    "開いた後にコマンドを貼り付け",
    "연 후 명령 붙여넣기",
    "Befehl nach dem Öffnen einfügen",
    "Pegar comando tras abrir",
    "Coller la commande après ouverture",
    "Incolla comando dopo l'apertura",
    "Colar comando após abrir",
    "Вставить команду после открытия"
  ),
  "desktop.settings.launchCopy": row(
    "コマンドのみコピー",
    "명령만 복사",
    "Nur Befehl kopieren",
    "Solo copiar comando",
    "Copier la commande uniquement",
    "Copia solo il comando",
    "Copiar apenas o comando",
    "Только скопировать команду"
  ),
  "desktop.settings.cmdT": row("⌘T ショートカット", "⌘T 단축키", "⌘T-Tastenkürzel", "Atajo ⌘T", "Raccourci ⌘T", "Scorciatoia ⌘T", "Atalho ⌘T", "Сочетание ⌘T"),
  "desktop.settings.cmdTDesc": row(
    "ワークベンチで ⌘T（Windows は Ctrl+T）を押したときの動作",
    "워크벤치에서 ⌘T(Windows는 Ctrl+T)를 누를 때 동작",
    "Aktion bei ⌘T (Windows: Ctrl+T) im Workbench",
    "Acción al pulsar ⌘T (Ctrl+T en Windows) en Workbench",
    "Action lors de ⌘T (Ctrl+T sous Windows) dans Workbench",
    "Azione premendo ⌘T (Ctrl+T su Windows) in Workbench",
    "Ação ao pressionar ⌘T (Ctrl+T no Windows) no Workbench",
    "Действие при ⌘T (Ctrl+T в Windows) в Workbench"
  ),
  "desktop.settings.cmdTNewTerminal": row("新規 Terminal", "새 Terminal", "Neues Terminal", "Nuevo terminal", "Nouveau terminal", "Nuovo terminale", "Novo terminal", "Новый Terminal"),
  "desktop.settings.cmdTNewSession": row("新規 Session", "새 Session", "Neue Session", "Nueva sesión", "Nouvelle session", "Nuova session", "Nova sessão", "Новая session"),
  "desktop.settings.scheduledDigests": row(
    "定期 digest",
    "예약 digest",
    "Geplante Digests",
    "Digests programados",
    "Digests planifiés",
    "Digest pianificati",
    "Digests agendados",
    "Запланированные digest"
  ),
  "desktop.settings.enableSchedule": row(
    "定期分析を有効化",
    "예약 분석 사용",
    "Geplante Analyse aktivieren",
    "Activar análisis programado",
    "Activer l’analyse planifiée",
    "Abilita analisi pianificata",
    "Ativar análise agendada",
    "Включить запланированный анализ"
  ),
  "desktop.settings.enableScheduleDesc": row(
    "指定時刻にツール LLM を呼び出し、日/週/月 digest を生成",
    "지정 시각에 도구 LLM을 호출해 일/주/월 digest 생성",
    "Ruft zum festgelegten Zeitpunkt Tool-LLM auf und erzeugt Tages-/Wochen-/Monats-Digests",
    "Llama al LLM de herramientas a horas fijas para generar digests diarios/semanales/mensuales",
    "Appelle le LLM outil aux heures définies pour générer des digests jour/semaine/mois",
    "Chiama l'LLM strumento agli orari impostati per generare digest giornalieri/settimanali/mensili",
    "Chama o LLM de ferramentas nos horários definidos para gerar digests diários/semanais/mensais",
    "Вызывает инструментальный LLM в заданное время для digest за день/неделю/месяц"
  ),
  "desktop.settings.dailyHour": row("日次の時刻", "일간 시각", "Tägliche Stunde", "Hora diaria", "Heure quotidienne", "Ora giornaliera", "Hora diária", "Час для дня"),
  "desktop.settings.weeklyHour": row("週次の時刻（月）", "주간 시각(월)", "Wöchentliche Stunde (Mo)", "Hora semanal (lun)", "Heure hebdomadaire (lun)", "Ora settimanale (lun)", "Hora semanal (seg)", "Час для недели (пн)"),
  "desktop.settings.monthlyHour": row("月次の時刻（1日）", "월간 시각(1일)", "Monatliche Stunde (Tag 1)", "Hora mensual (día 1)", "Heure mensuelle (jour 1)", "Ora mensile (giorno 1)", "Hora mensal (dia 1)", "Час для месяца (1-е число)"),
  "desktop.settings.backfillTitle": row(
    "履歴 digest の一括生成",
    "기록 digest 일괄 생성",
    "Historische Digests backfillen",
    "Rellenar digests históricos",
    "Remplir les digests historiques",
    "Backfill digest storici",
    "Preencher digests históricos",
    "Заполнить исторические digest"
  ),
  "desktop.settings.backfillCallout": row(
    "catalog の全 session 日付を走査し、日→週→月の順で一括生成。多数の LLM 呼び出しがあり、費用と時間がかかる場合があります。",
    "catalog의 모든 session 날짜를 스캔해 일→주→월 순으로 일괄 생성합니다. LLM 호출이 많아 비용과 시간이 들 수 있습니다.",
    "Scannt alle Session-Daten im Katalog und erzeugt Tag→Woche→Monat in Batches. Viele LLM-Aufrufe; Kosten und Dauer möglich.",
    "Escanea todas las fechas de sesión del catálogo y genera día→semana→mes por lotes. Muchas llamadas LLM; puede costar y tardar.",
    "Parcourt toutes les dates de session du catalogue et génère jour→semaine→mois par lots. Nombreux appels LLM ; coût et durée possibles.",
    "Scansiona tutte le date session nel catalogo e genera giorno→settimana→mese in batch. Molte chiamate LLM; possibili costi e tempi.",
    "Varre todas as datas de sessão do catálogo e gera dia→semana→mês em lote. Muitas chamadas LLM; pode gerar custo e demora.",
    "Сканирует все даты сессий в каталоге и пакетно генерирует день→неделя→месяц. Много вызовов LLM; возможны затраты и время."
  ),
  "desktop.settings.backfillMaxDays": row("最大日数", "최대 일수", "Max. Tage", "Días máx.", "Jours max.", "Giorni max.", "Dias máx.", "Макс. дней"),
  "desktop.settings.backfillSkipExisting": row(
    "既存の成功 digest をスキップ",
    "기존 성공 digest 건너뛰기",
    "Vorhandene erfolgreiche Digests überspringen",
    "Omitir digests exitosos existentes",
    "Ignorer les digests réussis existants",
    "Salta digest riusciti esistenti",
    "Ignorar digests bem-sucedidos existentes",
    "Пропускать уже успешные digest"
  ),
  "desktop.settings.backfillSkipEmbedding": row(
    "embedding をスキップ",
    "embedding 건너뛰기",
    "Embedding überspringen",
    "Omitir embedding",
    "Ignorer l’embedding",
    "Salta embedding",
    "Ignorar embedding",
    "Пропустить embedding"
  ),
  "desktop.settings.backfillPreview": row("範囲をプレビュー", "범위 미리보기", "Bereich vorschauen", "Vista previa del rango", "Aperçu de la plage", "Anteprima intervallo", "Pré-visualizar intervalo", "Предпросмотр диапазона"),
  "desktop.settings.backfillRun": row("一括生成を開始", "일괄 생성 시작", "Backfill starten", "Iniciar relleno", "Démarrer le remplissage", "Avvia backfill", "Iniciar preenchimento", "Начать заполнение"),
  "desktop.settings.appData": row("アプリデータ", "앱 데이터", "App-Daten", "Datos de la app", "Données de l’app", "Dati app", "Dados do app", "Данные приложения"),
  "desktop.settings.appDataFootnote": row(
    "catalog.db、acp/、notes/ は Panel home 配下にあります。",
    "catalog.db, acp/, notes/는 Panel home 아래에 있습니다.",
    "catalog.db, acp/, notes/ liegen unter Panel home.",
    "catalog.db, acp/, notes/ están bajo Panel home.",
    "catalog.db, acp/, notes/ se trouvent sous Panel home.",
    "catalog.db, acp/, notes/ sono sotto Panel home.",
    "catalog.db, acp/, notes/ ficam em Panel home.",
    "catalog.db, acp/, notes/ находятся в Panel home."
  ),
  "desktop.settings.panelHomeFootnote": row(
    "表示は保存済みパスを使用。変更は自動保存されます。",
    "표시는 저장된 경로를 사용합니다. 변경 사항은 자동 저장됩니다.",
    "Anzeigen nutzt gespeicherten Pfad; Änderungen werden automatisch gespeichert.",
    "Mostrar usa la ruta guardada; los cambios se guardan automáticamente.",
    "Afficher utilise le chemin enregistré ; les changements s’enregistrent automatiquement.",
    "Mostra usa il percorso salvato; le modifiche si salvano automaticamente.",
    "Revelar usa o caminho salvo; alterações são salvas automaticamente.",
    "Показать использует сохранённый путь; изменения сохраняются автоматически."
  ),
  "desktop.settings.notesGroup": row("ノート", "노트", "Notizen", "Notas", "Notes", "Note", "Notas", "Заметки"),
  "desktop.settings.notesFootnote": row(
    "ノートは Markdown ファイル。Finder / Obsidian で編集できます。",
    "노트는 Markdown 파일입니다. Finder / Obsidian에서 편집할 수 있습니다.",
    "Notizen sind Markdown-Dateien; bearbeitbar in Finder / Obsidian.",
    "Las notas son archivos Markdown; edítalas en Finder / Obsidian.",
    "Les notes sont des fichiers Markdown ; modifiables dans Finder / Obsidian.",
    "Le note sono file Markdown; modificabili in Finder / Obsidian.",
    "Notas são arquivos Markdown; edite no Finder / Obsidian.",
    "Заметки — файлы Markdown; редактируйте в Finder / Obsidian."
  ),
  "desktop.settings.agentHomesAdvanced": row(
    "Agent データディレクトリ（詳細）",
    "Agent 데이터 디렉터리(고급)",
    "Agent-Datenverzeichnisse (erweitert)",
    "Directorios de datos de agentes (avanzado)",
    "Répertoires de données des agents (avancé)",
    "Directory dati agent (avanzate)",
    "Diretórios de dados de agentes (avançado)",
    "Каталоги данных агентов (дополнительно)"
  ),
  "desktop.settings.saving": row("保存中…", "저장 중…", "Speichern…", "Guardando…", "Enregistrement…", "Salvataggio…", "Salvando…", "Сохранение…"),
  "desktop.settings.saved": row("保存済み{0}", "저장됨{0}", "Gespeichert{0}", "Guardado{0}", "Enregistré{0}", "Salvato{0}", "Salvo{0}", "Сохранено{0}"),
  "desktop.settings.schedulerOn": row(" · 定期 ON", " · 예약 ON", " · Planung AN", " · programación ON", " · planification ON", " · pianificazione ON", " · agendamento ON", " · расписание ВКЛ"),
  "desktop.settings.schedulerOff": row(" · 定期 OFF", " · 예약 OFF", " · Planung AUS", " · programación OFF", " · planification OFF", " · pianificazione OFF", " · agendamento OFF", " · расписание ВЫКЛ"),
  "desktop.settings.memoryEnableConfirm": row(
    "定期分析を有効にすると、設定時刻に session データを読み取り、ツール LLM / embedding API を呼び出します。費用が発生する場合があります。続行しますか？",
    "예약 분석을 사용하면 지정 시각에 session 데이터를 읽고 도구 LLM / embedding API를 호출합니다. 비용이 발생할 수 있습니다. 계속할까요?",
    "Die geplante Analyse liest Sitzungsdaten und ruft Tool-LLM-/Embedding-APIs zu festgelegten Zeiten auf; das kann Kosten verursachen. Fortfahren?",
    "El análisis programado leerá datos de sesión y llamará a las API de LLM/embedding a horas fijas; puede generar coste. ¿Continuar?",
    "L’analyse planifiée lira les données de session et appellera les API LLM/embedding aux heures définies ; cela peut engendrer des coûts. Continuer ?",
    "L’analisi pianificata leggerà i dati session e chiamerà API LLM/embedding agli orari impostati; può comportare costi. Continuare?",
    "A análise agendada lerá dados de sessão e chamará APIs LLM/embedding nos horários definidos; pode gerar custo. Continuar?",
    "Запланированный анализ будет читать данные сессий и вызывать API LLM/embedding в заданное время; возможны расходы. Продолжить?"
  ),
  "desktop.settings.aboutFeedback": row("フィードバック", "피드백", "Feedback", "Comentarios", "Retours", "Feedback", "Feedback", "Обратная связь"),
  "desktop.settings.aboutResources": row("リソース", "리소스", "Ressourcen", "Recursos", "Ressources", "Risorse", "Recursos", "Ресурсы"),
  "desktop.settings.aboutTagline": row(
    "コーディング Agent 向け Session OS + Memory",
    "코딩 에이전트를 위한 Session OS + Memory",
    "Session OS + Memory für Coding-Agenten",
    "Session OS + Memory para agentes de código",
    "Session OS + Memory pour agents de code",
    "Session OS + Memory per agent di codice",
    "Session OS + Memory para agentes de código",
    "Session OS + Memory для coding-агентов"
  ),
  "desktop.settings.aboutVersionLabel": row("Desktop", "Desktop", "Desktop", "Desktop", "Desktop", "Desktop", "Desktop", "Desktop"),
  "desktop.settings.linkDocumentationDesc": row(
    "ユーザーガイドと機能概要",
    "사용자 가이드 및 기능 개요",
    "Benutzerhandbuch und Funktionsübersicht",
    "Guía de usuario y descripción de funciones",
    "Guide utilisateur et aperçu des fonctionnalités",
    "Guida utente e panoramica funzioni",
    "Guia do usuário e visão geral dos recursos",
    "Руководство и обзор функций"
  ),
  "desktop.settings.linkExtensionDoc": row(
    "VS Code 拡張ドキュメント",
    "VS Code 확장 문서",
    "VS Code-Erweiterungsdokumentation",
    "Documentación de la extensión VS Code",
    "Documentation de l’extension VS Code",
    "Documentazione estensione VS Code",
    "Documentação da extensão VS Code",
    "Документация расширения VS Code"
  ),
  "desktop.settings.linkExtensionDocDesc": row(
    "VS Code サイドバー拡張機能",
    "VS Code 사이드바 확장 프로그램",
    "Begleitende VS Code-Sidebar-Erweiterung",
    "Extensión complementaria para la barra lateral de VS Code",
    "Extension compagnon pour la barre latérale VS Code",
    "Estensione complementare per la sidebar VS Code",
    "Extensão complementar da barra lateral do VS Code",
    "Дополнение для боковой панели VS Code"
  ),
  "desktop.settings.linkReportIssueDesc": row(
    "GitHub でバグ報告と機能要望",
    "GitHub에서 버그 및 기능 요청",
    "Fehlerberichte und Vorschläge auf GitHub",
    "Informes de errores y solicitudes en GitHub",
    "Bugs et suggestions sur GitHub",
    "Segnalazioni bug e richieste su GitHub",
    "Relatórios de bugs e sugestões no GitHub",
    "Сообщения об ошибках и предложения на GitHub"
  )
};

/** @returns {Record<string, Record<string, string>>} locale → key → value */
export function overridesByLocale() {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const locale of LOCALES) {
    out[locale] = {};
  }
  for (const [key, perLocale] of Object.entries(overridesByKey)) {
    for (const [locale, value] of Object.entries(perLocale)) {
      out[locale][key] = value;
    }
  }
  return out;
}