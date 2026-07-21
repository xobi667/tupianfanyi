'use client';

/* eslint-disable @next/next/no-img-element -- Studio images are local data URLs and must remain unoptimized. */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react';
import {
  Box,
  Download,
  Eraser,
  GripVertical,
  ImageIcon,
  Layers3,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OutputAspectRatio } from './options';

export type StudioInputAsset = {
  id: string;
  dataUrl: string;
  name: string;
  origin: 'upload' | 'history' | 'result';
};

export type StudioGeneratedAsset = {
  id: string;
  operationId: string;
  historyTaskId: string;
  historyTaskStartedAt: number;
  dataUrl: string;
  prompt: string;
  ratio: OutputAspectRatio;
  saved: boolean;
  saveError?: string;
  createdAt: number;
};

export type StudioFailedSlot = {
  assetId: string;
  operationId: string;
  historyTaskId: string;
  historyTaskStartedAt: number;
  index: number;
  prompt: string;
  ratio: OutputAspectRatio;
  error: string;
};

export type StudioSourceNodeData = {
  kind: 'source';
  asset: StudioInputAsset;
};

export type StudioGeneratorNodeData = {
  kind: 'generator';
  title: string;
  prompt: string;
  ratio: OutputAspectRatio;
  count: number;
  inputs: StudioInputAsset[];
  status: 'idle' | 'running' | 'partial' | 'done' | 'failed';
  completed: number;
  failed: number;
  error?: string;
};

export type StudioResultNodeData = {
  kind: 'result';
  title: string;
  assets: StudioGeneratedAsset[];
  selectedAssetId?: string;
  expectedCount: number;
  failedCount: number;
  failedSlots: StudioFailedSlot[];
  status: 'running' | 'partial' | 'done' | 'failed';
};

export type StudioNodeData =
  | StudioSourceNodeData
  | StudioGeneratorNodeData
  | StudioResultNodeData;

export type StudioNode = Node<StudioNodeData>;
export type StudioEdge = Edge;

type GeneratorPatch = Partial<Omit<StudioGeneratorNodeData, 'kind'>>;

type StudioFlowActions = {
  updateGenerator: (nodeId: string, patch: GeneratorPatch) => void;
  generate: (nodeId: string) => void;
  removeNode: (nodeId: string) => void;
  selectResult: (nodeId: string, assetId: string) => void;
  branchFromResult: (
    sourceNodeId: string,
    asset: StudioGeneratedAsset,
    prompt?: string,
  ) => void;
  download: (asset: StudioGeneratedAsset) => void;
  retryArchive: (asset: StudioGeneratedAsset) => void;
  recoverSlot: (nodeId: string, slot: StudioFailedSlot) => void;
};

const StudioFlowActionsContext = createContext<StudioFlowActions | null>(null);

const QUICK_RATIOS: OutputAspectRatio[] = [
  '1:1',
  '4:5',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
];

function useStudioFlowActions() {
  const value = useContext(StudioFlowActionsContext);
  if (!value) throw new Error('Studio flow actions are unavailable.');
  return value;
}

function SourceNode({ id, data, selected }: NodeProps) {
  const nodeData = data as StudioSourceNodeData;
  const actions = useStudioFlowActions();

  return (
    <article className={cn('ui-studio-node ui-studio-source-node', selected && 'is-selected')}>
      <div className="ui-studio-node-title">
        <span className="ui-studio-node-kicker"><ImageIcon className="h-3 w-3" />参考素材</span>
        <button type="button" onClick={() => actions.removeNode(id)} className="ui-studio-node-icon nodrag" aria-label="移除参考素材"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="ui-studio-source-preview nowheel">
        <img src={nodeData.asset.dataUrl} alt={nodeData.asset.name} draggable={false} />
      </div>
      <p className="ui-studio-source-name" title={nodeData.asset.name}>{nodeData.asset.name}</p>
      <Handle type="source" position={Position.Right} id="image" className="ui-studio-handle" />
    </article>
  );
}

function GeneratorNode({ id, data, selected }: NodeProps) {
  const nodeData = data as StudioGeneratorNodeData;
  const actions = useStudioFlowActions();
  const isRunning = nodeData.status === 'running';
  const totalFinished = nodeData.completed + nodeData.failed;

  return (
    <article className={cn('ui-studio-node ui-studio-generator-node', selected && 'is-selected')}>
      <Handle type="target" position={Position.Left} id="references" className="ui-studio-handle" />
      <div className="ui-studio-node-title">
        <span className="ui-studio-drag-mark"><GripVertical className="h-3.5 w-3.5" /></span>
        <span className="ui-studio-node-kicker"><WandSparkles className="h-3 w-3" />{nodeData.title}</span>
        <button type="button" onClick={() => actions.removeNode(id)} disabled={isRunning} className="ui-studio-node-icon nodrag" aria-label="移除生成器"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      {nodeData.inputs.length > 0 && (
        <div className="ui-studio-input-strip nodrag nowheel" aria-label="生成参考图">
          {nodeData.inputs.map((asset) => (
            <img key={asset.id} src={asset.dataUrl} alt={asset.name} title={asset.name} draggable={false} />
          ))}
          <span>{nodeData.inputs.length} 张参考</span>
        </div>
      )}

      <textarea
        value={nodeData.prompt}
        onChange={(event) => actions.updateGenerator(id, { prompt: event.target.value })}
        placeholder={nodeData.inputs.length ? '描述怎么改：换场景、调光、改构图…' : '描述商品、场景和想要的感觉…'}
        className="ui-studio-prompt nodrag nowheel"
        disabled={isRunning}
      />

      <div className="ui-studio-ratio-row nodrag nowheel" aria-label="输出比例">
        {QUICK_RATIOS.map((ratio) => (
          <button
            key={ratio}
            type="button"
            onClick={() => actions.updateGenerator(id, { ratio })}
            className={cn(nodeData.ratio === ratio && 'is-active')}
            disabled={isRunning}
          >
            {ratio}
          </button>
        ))}
      </div>

      <div className="ui-studio-generator-footer nodrag">
        <div className="ui-studio-count-stepper" aria-label="生成张数">
          <button type="button" onClick={() => actions.updateGenerator(id, { count: Math.max(1, nodeData.count - 1) })} disabled={isRunning || nodeData.count <= 1} aria-label="减少一张"><Minus className="h-3 w-3" /></button>
          <span>{nodeData.count} 张</span>
          <button type="button" onClick={() => actions.updateGenerator(id, { count: Math.min(10, nodeData.count + 1) })} disabled={isRunning || nodeData.count >= 10} aria-label="增加一张"><Plus className="h-3 w-3" /></button>
        </div>
        <button
          type="button"
          onClick={() => actions.generate(id)}
          disabled={isRunning || !nodeData.prompt.trim()}
          className="ui-studio-generate-button"
        >
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isRunning ? `${totalFinished}/${nodeData.count}` : `生成 ${nodeData.count} 张`}
        </button>
      </div>

      <div className="ui-studio-request-note nodrag">
        {isRunning
          ? '正在逐张安全提交；单张失败不会重发'
          : `${nodeData.count} 张 = ${nodeData.count} 次独立计费请求`}
      </div>
      {nodeData.error && <p className="ui-studio-node-error nodrag">{nodeData.error}</p>}
      <Handle type="source" position={Position.Right} id="results" className="ui-studio-handle" />
    </article>
  );
}

function ResultNode({ id, data, selected }: NodeProps) {
  const nodeData = data as StudioResultNodeData;
  const actions = useStudioFlowActions();
  const updateNodeInternals = useUpdateNodeInternals();
  const activeAsset = nodeData.assets.find((asset) => asset.id === nodeData.selectedAssetId)
    ?? nodeData.assets[0]
    ?? null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, nodeData.assets.length, updateNodeInternals]);

  return (
    <article className={cn('ui-studio-node ui-studio-result-node', selected && 'is-selected')}>
      <Handle type="target" position={Position.Left} id="batch" className="ui-studio-handle" />
      <div className="ui-studio-node-title">
        <span className="ui-studio-drag-mark"><GripVertical className="h-3.5 w-3.5" /></span>
        <span className="ui-studio-node-kicker"><Layers3 className="h-3 w-3" />{nodeData.title}</span>
        <span className="ui-studio-batch-count nodrag">{nodeData.assets.length}/{nodeData.expectedCount}</span>
        <button type="button" onClick={() => actions.removeNode(id)} disabled={nodeData.status === 'running'} className="ui-studio-node-icon nodrag" aria-label="移除结果批次"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className={cn('ui-studio-result-grid nodrag nowheel', nodeData.expectedCount === 1 && 'is-single')}>
        {nodeData.assets.map((asset, index) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => actions.selectResult(id, asset.id)}
            className={cn('ui-studio-result-tile', activeAsset?.id === asset.id && 'is-active')}
            aria-label={`选择结果 ${index + 1}`}
          >
            <img src={asset.dataUrl} alt={`生成结果 ${index + 1}`} draggable={false} />
            <span>{String(index + 1).padStart(2, '0')}</span>
            {!asset.saved && <i title={asset.saveError ?? '待归档'} />}
          </button>
        ))}
        {nodeData.status === 'running' && Array.from({ length: Math.max(0, nodeData.expectedCount - nodeData.assets.length) }, (_, index) => (
          <div key={`pending-${index}`} className="ui-studio-result-pending"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ))}
        {nodeData.status !== 'running' && nodeData.failedSlots.map((slot) => (
          <button
            key={slot.operationId}
            type="button"
            onClick={() => actions.recoverSlot(id, slot)}
            className="ui-studio-result-recover"
            title={slot.error}
          >
            <RefreshCw className="h-4 w-4" />
            <span>恢复第 {slot.index + 1} 张</span>
            <small>只查询原任务，不会重新付费提交</small>
          </button>
        ))}
        {nodeData.assets.length === 0 && nodeData.status !== 'running' && (
          <div className="ui-studio-result-empty"><ImageIcon className="h-5 w-5" />没有可用结果</div>
        )}
      </div>

      {activeAsset && (
        <div className="ui-studio-result-toolbar nodrag nowheel" aria-label="结果编辑工具">
          <button type="button" onClick={() => actions.branchFromResult(id, activeAsset)}><WandSparkles className="h-3.5 w-3.5" />快捷编辑</button>
          <button type="button" onClick={() => actions.branchFromResult(id, activeAsset, '保留商品主体、材质、颜色和构图，移除背景并生成干净的纯色或透明感电商背景，不添加文字或水印。')}><Eraser className="h-3.5 w-3.5" />背景清理</button>
          <button type="button" onClick={() => actions.branchFromResult(id, activeAsset, '保持同一个商品、材质、颜色与比例，生成一个新的专业电商展示角度，真实摄影光线，不添加文字或水印。')}><Box className="h-3.5 w-3.5" />新角度</button>
          <button type="button" onClick={() => actions.download(activeAsset)} aria-label="下载"><Download className="h-3.5 w-3.5" /></button>
          {!activeAsset.saved && <button type="button" onClick={() => actions.retryArchive(activeAsset)} title={activeAsset.saveError}><RefreshCw className="h-3.5 w-3.5" />重存</button>}
        </div>
      )}

      {nodeData.failedCount > 0 && (
        <p className="ui-studio-node-error nodrag">{nodeData.failedCount} 张失败，已保留成功结果；没有自动重发。</p>
      )}
      {nodeData.assets.map((asset, index) => (
        <Handle
          key={asset.id}
          type="source"
          position={Position.Right}
          id={`asset:${asset.id}`}
          className={cn('ui-studio-handle ui-studio-result-handle', activeAsset?.id === asset.id && 'is-active')}
          style={{ top: `${18 + ((index + 1) / (nodeData.assets.length + 1)) * 68}%` }}
        />
      ))}
    </article>
  );
}

const nodeTypes = {
  source: SourceNode,
  generator: GeneratorNode,
  result: ResultNode,
};

interface ImageStudioFlowProps {
  nodes: StudioNode[];
  edges: StudioEdge[];
  actions: StudioFlowActions;
  onNodesChange: (changes: NodeChange<StudioNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<StudioEdge>[]) => void;
  onEdgesUpdate: Dispatch<SetStateAction<StudioEdge[]>>;
  onConnectAsset: (connection: Connection) => boolean;
  onDropFiles: (files: FileList, position: XYPosition) => void;
  onCanvasClick: () => void;
  onActivateNode: (nodeId: string) => void;
}

function ImageStudioFlowInner({
  nodes,
  edges,
  actions,
  onNodesChange,
  onEdgesChange,
  onEdgesUpdate,
  onConnectAsset,
  onDropFiles,
  onCanvasClick,
  onActivateNode,
}: ImageStudioFlowProps) {
  const flowRef = useRef<ReactFlowInstance<StudioNode, StudioEdge> | null>(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.dataTransfer.files.length || !flowRef.current) return;
    onDropFiles(
      event.dataTransfer.files,
      flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  };

  return (
    <StudioFlowActionsContext.Provider value={actions}>
      <ReactFlow<StudioNode, StudioEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection) => {
          if (!onConnectAsset(connection)) return;
          onEdgesUpdate((current) => addEdge({
            ...connection,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          }, current));
        }}
        onInit={(instance) => { flowRef.current = instance; }}
        onPaneClick={onCanvasClick}
        onNodeClick={(_event, node) => onActivateNode(node.id)}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleDrop}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
        minZoom={0.22}
        maxZoom={1.45}
        panOnDrag={[1, 2]}
        selectionOnDrag
        selectNodesOnDrag={false}
        multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
        deleteKeyCode={null}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        defaultEdgeOptions={{
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        }}
        proOptions={{ hideAttribution: true }}
        className="ui-studio-flow"
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.15} color="rgba(167, 139, 250, 0.28)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </StudioFlowActionsContext.Provider>
  );
}

export function ImageStudioFlow(props: ImageStudioFlowProps) {
  return (
    <ReactFlowProvider>
      <ImageStudioFlowInner {...props} />
    </ReactFlowProvider>
  );
}
