import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type ReactPortal } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import type {
  FlowAdvanceResult,
  FlowDefinition,
  FlowGraphEdgeInput,
  FlowGraphNodeInput,
  FlowNode,
  FlowNodeStatus,
  FlowResultStatus,
  FlowRun,
  FlowTemplate,
  FlowWorkflow
} from "../../../shared/flowTypes";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

interface CanvasNodeData extends Record<string, unknown> {
  flowNode: FlowNode;
}

type CanvasNode = Node<CanvasNodeData, "flow">;
type Project = Awaited<ReturnType<ReturnType<typeof desktopApi>["listProjects"]>>[number];
type FlowPanelStatus = { text: string; kind?: StatusKind };

const PROVIDERS = ["codex", "claude", "grok", "opencode", "pi", "prime", "cursor", "cursor-ide"];
const NODE_STATUSES: FlowNodeStatus[] = ["idle", "ready", "running", "completed", "failed", "blocked", "skipped", "cancelled"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function graphNodes(flow: FlowDefinition): CanvasNode[] {
  return flow.nodes.map((flowNode) => ({
    id: flowNode.nodeId,
    type: "flow",
    position: { x: flowNode.positionX, y: flowNode.positionY },
    data: { flowNode }
  }));
}

function graphEdges(flow: FlowDefinition): Edge[] {
  return flow.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: "smoothstep"
  }));
}

function FlowNodeCard({ data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const node = data.flowNode;
  const status = node.status;
  return (
    <div className={`flow-node-card${selected ? " is-selected" : ""}${status === "running" ? " is-running" : ""}${status === "failed" || status === "blocked" ? ` is-${status}` : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-card-head">
        <span className={`flow-node-status-dot is-${status}`} aria-hidden="true" />
        <strong title={node.title}>{node.title}</strong>
      </div>
      <div className="flow-node-card-meta">
        <span>{node.provider}</span>
        <span>{node.bindingMode === "native" ? "Native" : "YOLO"}</span>
      </div>
      <div className="flow-node-card-state">{status}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { flow: FlowNodeCard };

export function FlowPanel(): ReactPortal | null {
  const host = document.getElementById("react-flow");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [flows, setFlows] = useState<FlowWorkflow[]>([]);
  const [flowId, setFlowId] = useState("");
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [sessions, setSessions] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["listSessions"]>>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState<FlowPanelStatus>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId) || null,
    [projectId, projects]
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId)?.data.flowNode || null,
    [nodes, selectedNodeId]
  );

  const setError = useCallback((error: unknown) => {
    setStatus({ text: errorMessage(error), kind: "error" });
  }, []);

  const syncGraph = useCallback((nextFlow: FlowDefinition | null) => {
    setNodes(nextFlow ? graphNodes(nextFlow) : []);
    setEdges(nextFlow ? graphEdges(nextFlow) : []);
    setSelectedNodeId(nextFlow?.nodes[0]?.nodeId || null);
  }, [setEdges, setNodes]);

  const loadProjects = useCallback(async () => {
    const next = await desktopApi().listProjects();
    setProjects(next);
    setProjectId((current) => next.some((project) => project.projectId === current) ? current : next[0]?.projectId || "");
  }, []);

  const loadFlows = useCallback(async (nextProjectId: string) => {
    if (!nextProjectId) {
      setFlows([]);
      setFlowId("");
      return;
    }
    const next = await desktopApi().flowList({ projectId: nextProjectId });
    setFlows(next);
    setFlowId((current) => next.some((item) => item.flowId === current) ? current : next[0]?.flowId || "");
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplates(await desktopApi().flowTemplatesList());
  }, []);

  const loadFlow = useCallback(async (nextFlowId: string) => {
    if (!nextFlowId) {
      setFlow(null);
      setRun(null);
      syncGraph(null);
      return;
    }
    const [nextFlow, nextRun] = await Promise.all([
      desktopApi().flowGet({ flowId: nextFlowId }),
      desktopApi().flowRunLatest({ flowId: nextFlowId })
    ]);
    setFlow(nextFlow);
    setRun(nextRun);
    syncGraph(nextFlow);
    setStatus({ text: "" });
  }, [syncGraph]);

  const refresh = useCallback(async () => {
    try {
      await loadProjects();
      await Promise.all([loadFlows(projectId), loadTemplates()]);
      if (flowId) await loadFlow(flowId);
    } catch (error) {
      setError(error);
    }
  }, [flowId, loadFlow, loadFlows, loadProjects, loadTemplates, projectId, setError]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "flow";
      setActive(show);
      if (show) void refresh();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [refresh]);

  useEffect(() => {
    void loadProjects().catch(setError);
    void loadTemplates().catch(setError);
  }, [loadProjects, loadTemplates, setError]);

  useEffect(() => {
    if (!projectId) {
      setFlows([]);
      setFlowId("");
      return;
    }
    void loadFlows(projectId).catch(setError);
  }, [loadFlows, projectId, setError]);

  useEffect(() => {
    void loadFlow(flowId).catch(setError);
  }, [flowId, loadFlow, setError]);

  useEffect(() => {
    if (!active || typeof desktopApi().onFlowChanged !== "function") return;
    return desktopApi().onFlowChanged((detail) => {
      if (!detail.flowId || detail.flowId === flowId) {
        void loadFlows(projectId).catch(setError);
        if (flowId) void loadFlow(flowId).catch(setError);
      }
    });
  }, [active, flowId, loadFlow, loadFlows, projectId, setError]);

  useEffect(() => {
    if (!active) return;
    void desktopApi().listSessions().then(setSessions).catch(() => setSessions([]));
  }, [active]);

  const updateNode = useCallback((nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, flowNode: { ...node.data.flowNode, ...patch } } }
      : node));
  }, [setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setEdges((current) => addEdge({ ...connection, id: newId("edge"), type: "smoothstep" }, current));
  }, [setEdges]);

  const saveGraph = useCallback(async () => {
    if (!flow) return;
    setBusy(true);
    try {
      const graphNodes: FlowGraphNodeInput[] = nodes.map((node, index) => {
        const item = node.data.flowNode;
        return {
          nodeId: item.nodeId,
          noteId: item.noteId,
          externalKey: item.externalKey,
          title: item.title,
          provider: item.provider,
          bindingMode: item.bindingMode,
          sessionProvider: item.sessionProvider,
          sessionId: item.sessionId,
          status: item.status,
          positionX: node.position.x,
          positionY: node.position.y,
          priority: item.priority ?? index
        };
      });
      const graphEdges: FlowGraphEdgeInput[] = edges.map((edge) => ({
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target
      }));
      const nextFlow = await desktopApi().flowUpdateGraph({ flowId: flow.flowId, name: flow.name, nodes: graphNodes, edges: graphEdges });
      setFlow(nextFlow);
      syncGraph(nextFlow);
      setFlows((current) => current.map((item) => item.flowId === nextFlow.flowId ? nextFlow : item));
      setStatus({ text: t("desktop.flow.saved"), kind: "ok" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [edges, flow, nodes, setError, syncGraph, t]);

  const createFlow = useCallback(async () => {
    if (!selectedProject) return setStatus({ text: t("desktop.flow.projectPathRequired"), kind: "error" });
    if (!selectedProject.localPath || selectedProject.pathMissing) {
      setStatus({ text: t("desktop.flow.projectPathRequired"), kind: "error" });
      return;
    }
    const name = window.prompt(t("desktop.flow.namePrompt"), t("desktop.flow.defaultName"))?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await desktopApi().flowCreate({ projectId: selectedProject.projectId, projectPath: selectedProject.localPath, name });
      setFlows((current) => [created, ...current]);
      setFlowId(created.flowId);
      setStatus({ text: t("desktop.flow.created"), kind: "ok" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [selectedProject, setError, t]);

  const deleteFlow = useCallback(async () => {
    if (!flow) return;
    if (!window.confirm(t("desktop.flow.deleteConfirm", flow.name))) return;
    setBusy(true);
    try {
      await desktopApi().flowDelete({ flowId: flow.flowId });
      const remaining = flows.filter((item) => item.flowId !== flow.flowId);
      setFlows(remaining);
      setFlowId(remaining[0]?.flowId || "");
      setStatus({ text: "", kind: undefined });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [flow, flows, setError, t]);

  const addNode = useCallback(() => {
    const index = nodes.length;
    const flowNode: FlowNode = {
      nodeId: newId("node"),
      flowId: flow?.flowId || "",
      noteId: "",
      title: t("desktop.flow.newNode"),
      provider: "codex",
      bindingMode: "new-yolo",
      status: "idle",
      positionX: 80 + (index % 3) * 240,
      positionY: 80 + Math.floor(index / 3) * 150,
      priority: index,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    };
    setNodes((current) => [...current, {
      id: flowNode.nodeId,
      type: "flow",
      position: { x: flowNode.positionX, y: flowNode.positionY },
      data: { flowNode }
    }]);
    setSelectedNodeId(flowNode.nodeId);
  }, [flow?.flowId, nodes.length, setNodes, t]);

  const removeNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, setEdges, setNodes]);

  const saveTemplate = useCallback(async () => {
    if (!flow) return;
    const name = window.prompt(t("desktop.flow.templateNamePrompt"), flow.name)?.trim();
    if (!name) return;
    try {
      await desktopApi().flowTemplateSave({ flowId: flow.flowId, name });
      await loadTemplates();
      setStatus({ text: t("desktop.flow.templateSaved"), kind: "ok" });
    } catch (error) {
      setError(error);
    }
  }, [flow, loadTemplates, setError, t]);

  const instantiateTemplate = useCallback(async (template: FlowTemplate) => {
    if (!selectedProject?.localPath || selectedProject.pathMissing) {
      setStatus({ text: t("desktop.flow.projectPathRequired"), kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const created = await desktopApi().flowTemplateInstantiate({
        templateId: template.templateId,
        projectId: selectedProject.projectId,
        projectPath: selectedProject.localPath,
        name: template.name
      });
      setFlows((current) => [created, ...current]);
      setFlowId(created.flowId);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [selectedProject, setError, t]);

  const deleteTemplate = useCallback(async (template: FlowTemplate) => {
    try {
      await desktopApi().flowTemplateDelete({ templateId: template.templateId });
      await loadTemplates();
    } catch (error) {
      setError(error);
    }
  }, [loadTemplates, setError]);

  const applyAdvance = useCallback((result: FlowAdvanceResult) => {
    setFlow(result.flow);
    setRun(result.run);
    syncGraph(result.flow);
  }, [syncGraph]);

  const runFlow = useCallback(async () => {
    if (!flow) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunStart({ flowId: flow.flowId }));
      setStatus({ text: t("desktop.flow.run"), kind: "ok" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, flow, setError, t]);

  const markRunning = useCallback(async () => {
    if (!run || !selectedNode) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunMarkNodeRunning({ runId: run.runId, nodeId: selectedNode.nodeId }));
      setStatus({ text: t("desktop.flow.nodeRunning", selectedNode.title), kind: "ok" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, run, selectedNode, setError, t]);

  const completeNode = useCallback(async (resultStatus: FlowResultStatus) => {
    if (!run || !selectedNode) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunCompleteNode({
        runId: run.runId,
        nodeId: selectedNode.nodeId,
        status: resultStatus,
        summary: resultStatus === "completed" ? "Completed manually" : `Marked ${resultStatus} manually`
      }));
      setStatus({ text: resultStatus === "completed" ? t("desktop.flow.runCompleted") : t("desktop.flow.runStopped", resultStatus), kind: resultStatus === "completed" ? "ok" : "warning" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, run, selectedNode, setError, t]);

  const setNodeStatus = useCallback(async (nextStatus: FlowNodeStatus) => {
    if (!flow || !selectedNode) return;
    setBusy(true);
    try {
      const nextFlow = await desktopApi().flowRunSetNodeStatus({ flowId: flow.flowId, runId: run?.runId, nodeId: selectedNode.nodeId, status: nextStatus });
      setFlow(nextFlow);
      syncGraph(nextFlow);
      setStatus({ text: t("desktop.flow.setStatus", nextStatus), kind: "ok" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [flow, run?.runId, selectedNode, setError, syncGraph, t]);

  const retryNode = useCallback(async () => {
    if (!run || !selectedNode) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunRetryNode({ runId: run.runId, nodeId: selectedNode.nodeId }));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, run, selectedNode, setError]);

  const skipNode = useCallback(async () => {
    if (!run || !selectedNode) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunSkipNode({ runId: run.runId, nodeId: selectedNode.nodeId }));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, run, selectedNode, setError]);

  const cancelRun = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    try {
      applyAdvance(await desktopApi().flowRunCancel({ runId: run.runId }));
      setStatus({ text: t("desktop.flow.runStopped", "cancelled"), kind: "warning" });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, [applyAdvance, run, setError, t]);

  const bindSession = useCallback(async (value: string) => {
    if (!flow || !selectedNode || !value) return;
    const [provider, sessionId] = value.split("\u0000");
    try {
      const nextFlow = await desktopApi().flowBindSession({ flowId: flow.flowId, nodeId: selectedNode.nodeId, provider, sessionId });
      setFlow(nextFlow);
      syncGraph(nextFlow);
    } catch (error) {
      setError(error);
    }
  }, [flow, selectedNode, setError, syncGraph]);

  const projectOptions = projects.filter((project) => !project.hidden || project.projectId === projectId);
  const runProgress = run && run.nodes.length
    ? Math.round((run.nodes.filter((node) => node.status === "completed" || node.status === "skipped").length / run.nodes.length) * 100)
    : 0;

  if (!host) return null;
  return createPortal(
    <section className="react-flow-panel panel" hidden={!active}>
      <div className="flow-toolbar">
        <div className="flow-toolbar-title">
          <strong>{t("desktop.flow.title")}</strong>
          {flow && <span className={`flow-run-badge is-${flow.status}`}>{flow.status}</span>}
        </div>
        <div className="flow-toolbar-actions">
          <button type="button" className="tool-btn" onClick={() => void createFlow()} disabled={busy || !selectedProject}>{t("desktop.flow.newFlow")}</button>
          <button type="button" className="tool-btn" onClick={() => void saveGraph()} disabled={busy || !flow}>{t("desktop.flow.saved")}</button>
          <button type="button" className="tool-btn" onClick={() => void runFlow()} disabled={busy || !flow || flow.status === "running"}>{t("desktop.flow.run")}</button>
          <button type="button" className="tool-btn" onClick={() => void cancelRun()} disabled={busy || !run || run.status !== "running"}>{t("desktop.flow.stop")}</button>
        </div>
      </div>
      <div className="flow-layout">
        <aside className="flow-sidebar">
          <label className="flow-field">
            <span>{t("desktop.flow.project")}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">{t("desktop.flow.project")}</option>
              {projectOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.alias || project.localPath || project.portableKey}</option>)}
            </select>
          </label>
          <div className="flow-sidebar-head"><span>{t("desktop.flow.workflows")}</span><button type="button" className="icon-btn" onClick={() => void loadFlows(projectId)} aria-label={t("desktop.common.refresh")}>↻</button></div>
          <div className="flow-list">
            {!flows.length && <p className="flow-empty">{t("desktop.flow.empty")}</p>}
            {flows.map((item) => (
              <button key={item.flowId} type="button" className={`flow-list-row${item.flowId === flowId ? " active" : ""}`} onClick={() => setFlowId(item.flowId)}>
                <span>{item.name}</span><small>{item.status}</small>
              </button>
            ))}
          </div>
          <div className="flow-sidebar-head flow-template-head"><span>{t("desktop.flow.templates")}</span></div>
          <div className="flow-template-list">
            {templates.map((template) => (
              <div className="flow-template-row" key={template.templateId}>
                <button type="button" onClick={() => void instantiateTemplate(template)}>{template.name}</button>
                <button type="button" className="flow-template-delete" onClick={() => void deleteTemplate(template)} aria-label={t("desktop.flow.removeNode")}>×</button>
              </div>
            ))}
          </div>
          {flow && <div className="flow-sidebar-head"><span>{t("desktop.flow.inspector")}</span></div>}
          {flow && <div className="flow-toolbar-actions">
            <button type="button" className="tool-btn" onClick={addNode} disabled={busy}>{t("desktop.flow.addNode")}</button>
            <button type="button" className="tool-btn" onClick={removeNode} disabled={busy || !selectedNode}>{t("desktop.flow.removeNode")}</button>
            <button type="button" className="tool-btn" onClick={() => void saveTemplate()} disabled={busy}>{t("desktop.flow.saveTemplate")}</button>
            <button type="button" className="tool-btn context-menu-item-danger" onClick={() => void deleteFlow()} disabled={busy}>{t("desktop.flow.removeNode")}</button>
          </div>}
        </aside>
        <div className="flow-canvas-shell">
          {!flow && <div className="flow-canvas-empty"><div><h3>{t("desktop.flow.emptyTitle")}</h3><p>{t("desktop.flow.emptyHint")}</p></div></div>}
          {flow && <ReactFlow<CanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            nodesConnectable
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap nodeColor={(node: CanvasNode) => node.data?.flowNode?.status === "completed" ? "#34c759" : node.data?.flowNode?.status === "failed" ? "#ff3b30" : "#0a84ff"} />
          </ReactFlow>}
        </div>
        <aside className="flow-inspector">
          <h3>{t("desktop.flow.nodeInspector")}</h3>
          {!selectedNode && <p>{t("desktop.flow.selectNodeHint")}</p>}
          {selectedNode && <div className="flow-inspector-form">
            <label>{t("desktop.flow.nodeTitle")}
              <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.nodeId, { title: event.target.value })} />
            </label>
            <label>{t("desktop.flow.provider")}
              <select value={selectedNode.provider} onChange={(event) => updateNode(selectedNode.nodeId, { provider: event.target.value })}>
                {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
            </label>
            <label>{t("desktop.flow.sessionMode")}
              <select value={selectedNode.bindingMode} onChange={(event) => updateNode(selectedNode.nodeId, { bindingMode: event.target.value as FlowNode["bindingMode"] })}>
                <option value="new-yolo">{t("desktop.flow.newYolo")}</option>
                <option value="native">{t("desktop.flow.native")}</option>
              </select>
            </label>
            {selectedNode.bindingMode === "new-yolo" && <p className="flow-yolo-hint">{t("desktop.flow.yoloHint")}</p>}
            {selectedNode.bindingMode === "native" && <label>{t("desktop.flow.nativeSession")}
              <select value={selectedNode.sessionProvider && selectedNode.sessionId ? `${selectedNode.sessionProvider}\u0000${selectedNode.sessionId}` : ""} onChange={(event) => void bindSession(event.target.value)}>
                <option value="">{t("desktop.flow.selectSession")}</option>
                {sessions.filter((session) => !selectedProject?.localPath || session.projectPath === selectedProject.localPath).map((session) => <option key={`${session.provider}:${session.id}`} value={`${session.provider}\u0000${session.id}`}>{session.title || session.id}</option>)}
              </select>
            </label>}
            <label>{t("desktop.flow.setStatus", "")}
              <select value={selectedNode.status} onChange={(event) => void setNodeStatus(event.target.value as FlowNodeStatus)}>
                {NODE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="flow-toolbar-actions">
              <button type="button" className="tool-btn" onClick={() => void markRunning()} disabled={busy || !run || run.status !== "running"}>{t("desktop.flow.nodeRunning", selectedNode.title)}</button>
              <button type="button" className="tool-btn" onClick={() => void completeNode("completed")} disabled={busy || !run}>{t("desktop.flow.runCompleted")}</button>
              <button type="button" className="tool-btn" onClick={() => void retryNode()} disabled={busy || !run}>{t("desktop.flow.retryNode")}</button>
              <button type="button" className="tool-btn" onClick={() => void skipNode()} disabled={busy || !run}>{t("desktop.flow.skipNode")}</button>
            </div>
          </div>}
          {run && <div className="flow-run-summary">
            <h4>{t("desktop.flow.currentRun")}</h4>
            <code>{run.runId}</code>
            <span>{run.status}</span>
            <progress value={runProgress} max={100} />
          </div>}
        </aside>
      </div>
      <div className={`flow-status${status.kind ? ` is-${status.kind}` : ""}`}><Status kind={status.kind}>{status.text}</Status></div>
    </section>,
    host
  );
}
