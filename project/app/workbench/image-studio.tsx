'use client';

/* eslint-disable @next/next/no-img-element -- History previews are local data URLs and must remain unoptimized. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useEdgesState,
  useNodesState,
  type Connection,
  type XYPosition,
} from '@xyflow/react';
import {
  Download,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  normalizeSettings,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { cn } from '@/lib/utils';
import { createHistoryTaskId, downloadDataUrl, readFileAsDataUrl } from './files';
import {
  acknowledgeGenerateJobFamily,
  fetchGenerateApiResponse,
  recoverGenerateApiResponse,
} from './generate-job-client';
import { postHistory, type HistoryImageRecord, type HistoryTaskRecord } from './history-client';
import {
  ImageStudioFlow,
  type StudioEdge,
  type StudioFailedSlot,
  type StudioGeneratedAsset,
  type StudioGeneratorNodeData,
  type StudioInputAsset,
  type StudioNode,
  type StudioResultNodeData,
} from './image-studio-flow';
import type { OutputAspectRatio } from './options';
import { getImageModelCostRisk } from './settings';

type StudioHistoryItem = {
  taskId: string;
  imageId: string;
  name: string;
  ratio: string;
  createdAt: number;
  previewUrl: string;
};

const MAX_REFERENCE_IMAGES_PER_GENERATOR = 4;
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 48 * 1024 * 1024;
const DEFAULT_GENERATOR_POSITION = { x: 260, y: 120 };
const VALID_STUDIO_RATIOS = new Set<OutputAspectRatio>([
  'original', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '16:9',
  '9:16', '21:9', '5:4', '2:1', '1:2', '3:1', '1:3', '5:7',
]);

function createStudioId(prefix: string) {
  return `${prefix}_${typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}`;
}

function inlineDataFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('参考图片格式无效。');
  return {
    mimeType: match[1],
    data: match[2].replace(/\s/g, ''),
  };
}

function readGeneratedImage(response: GatewayGenerateResponse) {
  const part = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((item) => item.inlineData?.data || item.inline_data?.data);
  const mimeType = part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? 'image/png';
  const data = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!data) throw new Error(response.error?.message || '上游没有返回可保存的图片。');
  return `data:${mimeType};base64,${data}`;
}

function getDataUrlExtension(dataUrl: string) {
  const mimeType = /^data:([^;,]+)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? '';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/avif') return 'avif';
  return 'png';
}

function getApproximateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/\s/g, '');
  return Math.floor((base64.length * 3) / 4);
}

function getInputBytes(inputs: StudioInputAsset[]) {
  return inputs.reduce((total, input) => total + getApproximateDataUrlBytes(input.dataUrl), 0);
}

function normalizeStudioRatio(value: string): OutputAspectRatio {
  return VALID_STUDIO_RATIOS.has(value as OutputAspectRatio)
    ? value as OutputAspectRatio
    : '1:1';
}

function formatStudioTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function createGeneratorNode(
  id: string,
  position: XYPosition,
  options?: {
    title?: string;
    prompt?: string;
    ratio?: OutputAspectRatio;
    inputs?: StudioInputAsset[];
  },
): StudioNode {
  return {
    id,
    type: 'generator',
    position,
    data: {
      kind: 'generator',
      title: options?.title ?? '图像生成器',
      prompt: options?.prompt ?? '',
      ratio: options?.ratio ?? '4:5',
      count: 1,
      inputs: options?.inputs ?? [],
      status: 'idle',
      completed: 0,
      failed: 0,
    },
  };
}

function createSourceNode(asset: StudioInputAsset, position: XYPosition): StudioNode {
  return {
    id: createStudioId('source'),
    type: 'source',
    position,
    data: { kind: 'source', asset },
  };
}

function isGeneratorNode(node: StudioNode): node is StudioNode & { data: StudioGeneratorNodeData } {
  return node.data.kind === 'generator';
}

function isResultNode(node: StudioNode): node is StudioNode & { data: StudioResultNodeData } {
  return node.data.kind === 'result';
}

interface ImageStudioProps {
  settings: GatewaySettings;
  suspended?: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function ImageStudio({ settings, suspended = false, onClose, onOpenSettings }: ImageStudioProps) {
  const initialGeneratorIdRef = useRef(createStudioId('generator'));
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([
    createGeneratorNode(initialGeneratorIdRef.current, DEFAULT_GENERATOR_POSITION),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioEdge>([]);
  const [error, setError] = useState<string | null>(null);
  const [highCostAcknowledged, setHighCostAcknowledged] = useState(false);
  const [studioHistoryOpen, setStudioHistoryOpen] = useState(false);
  const [studioHistory, setStudioHistory] = useState<StudioHistoryItem[]>([]);
  const [studioHistoryLoading, setStudioHistoryLoading] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const historyLoadRequestRef = useRef(0);
  const referenceHistoryTaskIdRef = useRef<string | null>(null);
  const referenceProjectStartedAtRef = useRef<number | null>(null);
  const latestGeneratorIdRef = useRef(initialGeneratorIdRef.current);
  const generatingNodeIdsRef = useRef<Set<string>>(new Set());
  const activeOperationIdsRef = useRef<Set<string>>(new Set());
  const recoveringOperationIdsRef = useRef<Set<string>>(new Set());
  const addingReferencesRef = useRef(false);
  const nodesRef = useRef(nodes);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const imageModelRisk = getImageModelCostRisk(settings.imageModel);
  const isGenerating = nodes.some(
    (node) => isGeneratorNode(node) && node.data.status === 'running',
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !suspended && !isGenerating && !studioHistoryOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGenerating, onClose, studioHistoryOpen, suspended]);

  const updateGenerator = useCallback((nodeId: string, patch: Partial<Omit<StudioGeneratorNodeData, 'kind'>>) => {
    setNodes((current) => current.map((node) => (
      node.id === nodeId && isGeneratorNode(node)
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [setNodes]);

  const updateResult = useCallback((nodeId: string, patch: Partial<Omit<StudioResultNodeData, 'kind'>>) => {
    setNodes((current) => current.map((node) => (
      node.id === nodeId && isResultNode(node)
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [setNodes]);

  const loadStudioHistory = useCallback(async () => {
    const requestSequence = historyLoadRequestRef.current + 1;
    historyLoadRequestRef.current = requestSequence;
    setStudioHistoryLoading(true);
    try {
      const response = await fetch('/api/history?scope=generate&preview=1&previewLimit=40&limit=80');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? '作品记录读取失败。');
      if (requestSequence !== historyLoadRequestRef.current) return;
      const historyTasks = (payload.tasks as HistoryTaskRecord[] | undefined) ?? [];
      const finalizableImages = historyTasks.flatMap((task) => task.images.flatMap((image) => (
        image.generationOperationId
        && image.resultPath
        && image.status !== 'success'
        && image.status !== 'copied'
          ? [{ taskId: task.id, image }]
          : []
      )));
      for (const { taskId, image } of finalizableImages) {
        if (requestSequence !== historyLoadRequestRef.current) return;
        try {
          await postHistory('update-image', {
            taskId,
            imageId: image.id,
            patch: {
              status: 'success',
              phase: 'done',
              completedAt: image.completedAt ?? Date.now(),
              generationOperationId: image.generationOperationId,
            },
          });
          await acknowledgeGenerateJobFamily(image.generationOperationId);
        } catch {
          // The visible result already exists; a later history refresh can finalize it again.
        }
      }
      const items = historyTasks.flatMap((task) =>
        (task.previewImages ?? []).filter((preview) => preview.kind === 'result').map((preview) => ({
          taskId: task.id,
          imageId: preview.id,
          name: preview.name,
          ratio: task.ratio,
          createdAt: task.updatedAt,
          previewUrl: preview.dataUrl ?? '',
        })).filter((item) => item.previewUrl),
      );
      if (requestSequence !== historyLoadRequestRef.current) return;
      setStudioHistory(items);
      const recoverableBatches = historyTasks
        .filter((task) => task.mode === 'generate')
        .map((task) => ({
          task,
          slots: task.images.flatMap((image, index) => {
            if (
              !image.generationOperationId
              || image.resultPath
              || !['generating', 'error', 'paused'].includes(image.status)
              || activeOperationIdsRef.current.has(image.generationOperationId)
            ) return [];
            return [{
              assetId: image.id,
              operationId: image.generationOperationId,
              historyTaskId: task.id,
              historyTaskStartedAt: task.createdAt,
              index,
              prompt: '',
              ratio: normalizeStudioRatio(task.ratio),
              error: image.error ?? '原任务没有完成前端归档，可安全查询恢复。',
            } satisfies StudioFailedSlot];
          }),
        }))
        .filter((batch) => batch.slots.length > 0);
      if (recoverableBatches.length > 0) {
        setNodes((current) => {
          const knownOperations = new Set(current.flatMap((node) => {
            if (!isResultNode(node)) return [];
            return [
              ...node.data.assets.map((asset) => asset.operationId),
              ...node.data.failedSlots.map((slot) => slot.operationId),
            ];
          }));
          const recoveryNodes = recoverableBatches.flatMap(({ task, slots }, index) => {
            const remainingSlots = slots.filter((slot) => !knownOperations.has(slot.operationId));
            if (remainingSlots.length === 0) return [];
            return [{
              id: `recovery_${task.id}`,
              type: 'result',
              position: { x: 790 + index * 54, y: 100 + index * 90 },
              data: {
                kind: 'result',
                title: `可恢复批次 · ${formatStudioTime(task.updatedAt)}`,
                assets: [],
                expectedCount: remainingSlots.length,
                failedCount: remainingSlots.length,
                failedSlots: remainingSlots,
                status: 'failed',
              } satisfies StudioResultNodeData,
            } satisfies StudioNode];
          });
          return recoveryNodes.length > 0 ? [...current, ...recoveryNodes] : current;
        });
      }
    } catch (historyError) {
      if (requestSequence === historyLoadRequestRef.current) {
        setError(historyError instanceof Error ? historyError.message : '作品记录读取失败。');
      }
    } finally {
      if (requestSequence === historyLoadRequestRef.current) {
        setStudioHistoryLoading(false);
      }
    }
  }, [setNodes]);

  useEffect(() => {
    void loadStudioHistory();
  }, [loadStudioHistory]);

  const saveToHistory = useCallback(async (asset: StudioGeneratedAsset) => {
    const taskId = asset.historyTaskId;
    const startedAt = asset.historyTaskStartedAt;
    const extension = getDataUrlExtension(asset.dataUrl);
    const fileName = `xobi-生图-${asset.createdAt}.${extension}`;

    await postHistory('upsert-task', {
      task: {
        id: taskId,
        name: `生图批次 · ${formatStudioTime(startedAt)}`,
        language: '文生图',
        ratio: asset.ratio,
        mode: 'generate',
        settingsSummary: {
          imageModel: settings.imageModel,
          textModel: settings.textModel,
          apiBaseUrl: settings.apiBaseUrl,
          maxParallelTasks: Math.min(2, settings.maxParallelTasks),
          imageRequestTimeoutMs: settings.imageRequestTimeoutMs,
          skipOcr: settings.skipOcr,
        },
      },
      images: [{
        id: asset.id,
        name: fileName,
        relativePath: fileName,
        outputRelativePath: fileName,
        groupLabel: '生图工作台',
        status: 'generating',
        phase: 'saving',
        sourceKind: 'file',
        pathKey: asset.id,
        generationOperationId: asset.operationId,
        startedAt: asset.createdAt,
      }],
    });
    await postHistory('save-image', {
      taskId,
      imageId: asset.id,
      kind: 'result',
      relativePath: fileName,
      dataUrl: asset.dataUrl,
    });
    await postHistory('update-image', {
      taskId,
      imageId: asset.id,
      patch: {
        status: 'success',
        phase: 'done',
        completedAt: asset.createdAt,
        generationOperationId: asset.operationId,
      },
    });
  }, [settings]);

  const archiveReferenceAssets = useCallback(async (assets: StudioInputAsset[]) => {
    if (assets.length === 0) return;
    const taskId = referenceHistoryTaskIdRef.current ?? createHistoryTaskId();
    const startedAt = referenceProjectStartedAtRef.current ?? Date.now();
    referenceHistoryTaskIdRef.current = taskId;
    referenceProjectStartedAtRef.current = startedAt;
    const records = assets.map((asset, index) => {
      const extension = getDataUrlExtension(asset.dataUrl);
      const fileName = `参考图-${Date.now()}-${index + 1}.${extension}`;
      return { asset, fileName };
    });

    await postHistory('upsert-task', {
      task: {
        id: taskId,
        name: `生图项目 · ${formatStudioTime(startedAt)}`,
        language: '文生图',
        ratio: '参考图',
        mode: 'generate-reference',
        settingsSummary: {
          imageModel: settings.imageModel,
          textModel: settings.textModel,
          apiBaseUrl: settings.apiBaseUrl,
          maxParallelTasks: Math.min(2, settings.maxParallelTasks),
          imageRequestTimeoutMs: settings.imageRequestTimeoutMs,
          skipOcr: settings.skipOcr,
        },
      },
      images: records.map(({ asset, fileName }) => ({
        id: asset.id,
        name: asset.name,
        relativePath: fileName,
        outputRelativePath: fileName,
        groupLabel: '生图参考',
        status: 'copied',
        phase: 'copied',
        sourceKind: 'file',
        pathKey: asset.id,
        completedAt: Date.now(),
      })),
    });
    for (const { asset, fileName } of records) {
      await postHistory('save-image', {
        taskId,
        imageId: asset.id,
        kind: 'original',
        relativePath: fileName,
        dataUrl: asset.dataUrl,
      });
    }
  }, [settings]);

  const addReferences = useCallback(async (
    files: FileList | File[],
    position?: XYPosition,
    origin: StudioInputAsset['origin'] = 'upload',
  ) => {
    const currentTarget = nodes.find(
      (node): node is StudioNode & { data: StudioGeneratorNodeData } =>
        node.id === latestGeneratorIdRef.current && isGeneratorNode(node),
    );
    if (currentTarget?.data.status === 'running') {
      setError('当前生成器正在运行，参考图已锁定。请等待批次完成后再添加。');
      return;
    }
    if (currentTarget && generatingNodeIdsRef.current.has(currentTarget.id)) {
      setError('当前生成器正在准备付费任务，参考图已经锁定。');
      return;
    }
    const availableSlots = currentTarget
      ? MAX_REFERENCE_IMAGES_PER_GENERATOR - currentTarget.data.inputs.length
      : MAX_REFERENCE_IMAGES_PER_GENERATOR;
    if (availableSlots <= 0) {
      setError(`当前生成器已有 ${MAX_REFERENCE_IMAGES_PER_GENERATOR} 张参考图；请新建生成器或移除一个参考节点。`);
      return;
    }
    const acceptedFiles = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, availableSlots);
    if (acceptedFiles.length === 0) {
      setError('请选择图片文件作为商品或风格参考。');
      return;
    }
    const oversizedFile = acceptedFiles.find((file) => file.size > MAX_REFERENCE_IMAGE_BYTES);
    if (oversizedFile) {
      setError(`“${oversizedFile.name}”超过 20 MB，先压缩后再添加。`);
      return;
    }
    const totalFileBytes = acceptedFiles.reduce((total, file) => total + file.size, 0);
    if (totalFileBytes > MAX_REFERENCE_TOTAL_BYTES) {
      setError('本次参考图合计超过 48 MB。请压缩图片或减少参考图，避免请求体过大。');
      return;
    }
    if (addingReferencesRef.current) {
      setError('上一组参考图仍在读取和保存，请稍候。');
      return;
    }

    addingReferencesRef.current = true;
    try {
      const assets = await Promise.all(acceptedFiles.map(async (file) => ({
        id: createStudioId('input'),
        dataUrl: await readFileAsDataUrl(file),
        name: file.name,
        origin,
      } satisfies StudioInputAsset)));
      if (getInputBytes([...(currentTarget?.data.inputs ?? []), ...assets]) > MAX_REFERENCE_TOTAL_BYTES) {
        setError('当前生成器的参考图合计会超过 48 MB。请压缩图片或新建生成器。');
        return;
      }
      try {
        await archiveReferenceAssets(assets);
      } catch (archiveError) {
        setError(`参考原图保存失败，已停止加入画布：${archiveError instanceof Error ? archiveError.message : '无法写入本地资源。'}`);
        return;
      }
      const liveTarget = currentTarget
        ? nodesRef.current.find(
            (node): node is StudioNode & { data: StudioGeneratorNodeData } =>
              node.id === currentTarget.id && isGeneratorNode(node),
          )
        : undefined;
      if (currentTarget && !liveTarget) {
        setError('目标生成器已被移除。参考原图已安全保存，请重新选择生成器后再添加。');
        return;
      }
      if (liveTarget?.data.status === 'running') {
        setError('目标生成器已经开始运行，本次参考图未连接到正在付费的批次。');
        return;
      }
      if (liveTarget && liveTarget.data.inputs.length + assets.length > MAX_REFERENCE_IMAGES_PER_GENERATOR) {
        setError(`目标生成器最多连接 ${MAX_REFERENCE_IMAGES_PER_GENERATOR} 张参考图，本次没有静默截断。`);
        return;
      }
      if (liveTarget && getInputBytes([...liveTarget.data.inputs, ...assets]) > MAX_REFERENCE_TOTAL_BYTES) {
        setError('目标生成器的参考图合计超过 48 MB，本次没有连接。');
        return;
      }
      const generatorId = liveTarget?.id ?? createStudioId('generator');
      if (!liveTarget) latestGeneratorIdRef.current = generatorId;
      const basePosition = position ?? { x: 40, y: 80 + nodesRef.current.filter((node) => node.type === 'source').length * 230 };
      const sourceNodes = assets.map((asset, index) => createSourceNode(asset, {
        x: basePosition.x,
        y: basePosition.y + index * 230,
      }));
      setNodes((current) => [
        ...current,
        ...(!liveTarget ? [createGeneratorNode(generatorId, {
          x: basePosition.x + 320,
          y: basePosition.y,
        })] : []),
        ...sourceNodes,
      ].map((node) => (
        node.id === generatorId && isGeneratorNode(node)
          ? {
              ...node,
              data: {
                ...node.data,
                inputs: [...node.data.inputs, ...assets]
                  .filter((asset, index, all) => all.findIndex((item) => item.id === asset.id) === index)
                  .slice(0, MAX_REFERENCE_IMAGES_PER_GENERATOR),
              },
            }
          : node
      )));
      setEdges((current) => [
        ...current,
        ...sourceNodes.map((sourceNode) => ({
          id: createStudioId('edge'),
          source: sourceNode.id,
          sourceHandle: 'image',
          target: generatorId,
          targetHandle: 'references',
          type: 'smoothstep',
        })),
      ]);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取参考图片失败。');
    } finally {
      addingReferencesRef.current = false;
    }
  }, [archiveReferenceAssets, nodes, setEdges, setNodes]);

  const addGenerator = useCallback(() => {
    const generatorCount = nodes.filter((node) => node.type === 'generator').length;
    const id = createStudioId('generator');
    latestGeneratorIdRef.current = id;
    setNodes((current) => [
      ...current,
      createGeneratorNode(id, {
        x: DEFAULT_GENERATOR_POSITION.x + generatorCount * 70,
        y: DEFAULT_GENERATOR_POSITION.y + generatorCount * 90,
      }, { title: `图像生成器 ${generatorCount + 1}` }),
    ]);
    setError(null);
  }, [nodes, setNodes]);

  const removeNode = useCallback((nodeId: string) => {
    const candidate = nodes.find((node) => node.id === nodeId);
    if (!candidate) return;
    if (
      isGeneratorNode(candidate)
      && (candidate.data.status === 'running' || generatingNodeIdsRef.current.has(candidate.id))
    ) return;
    const candidateAssetIds = candidate.data.kind === 'source'
      ? [candidate.data.asset.id]
      : isResultNode(candidate)
        ? candidate.data.assets.map((asset) => asset.id)
        : [];
    const hasRunningDependent = nodes.some((node) => (
      isGeneratorNode(node)
      && (node.data.status === 'running' || generatingNodeIdsRef.current.has(node.id))
      && node.data.inputs.some((input) => candidateAssetIds.includes(input.id))
    ));
    if (hasRunningDependent) {
      setError('该素材正在被运行中的生成器使用，批次完成前不能删除。');
      return;
    }
    setNodes((current) => {
      const removed = current.find((node) => node.id === nodeId);
      if (!removed) return current;
      if (isGeneratorNode(removed) && removed.data.status === 'running') return current;
      const removedAssetIds = removed.data.kind === 'source'
        ? [removed.data.asset.id]
        : isResultNode(removed)
          ? removed.data.assets.map((asset) => asset.id)
          : [];
      const next = current
        .filter((node) => node.id !== nodeId)
        .map((node) => (
          removedAssetIds.length > 0 && isGeneratorNode(node)
            ? { ...node, data: { ...node.data, inputs: node.data.inputs.filter((item) => !removedAssetIds.includes(item.id)) } }
            : node
        ));
      if (nodeId === latestGeneratorIdRef.current) {
        latestGeneratorIdRef.current = next.findLast(isGeneratorNode)?.id ?? initialGeneratorIdRef.current;
      }
      return next;
    });
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, [nodes, setEdges, setNodes]);

  const connectAsset = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode || !isGeneratorNode(targetNode)) return false;
    if (targetNode.data.status === 'running') {
      setError('运行中的生成器已锁定参考图，批次完成后才能连接新素材。');
      return false;
    }
    if (generatingNodeIdsRef.current.has(targetNode.id)) {
      setError('目标生成器正在准备付费任务，参考图已经锁定。');
      return false;
    }

    let input: StudioInputAsset | null = null;
    if (sourceNode.data.kind === 'source') {
      input = sourceNode.data.asset;
    } else if (isResultNode(sourceNode) && connection.sourceHandle?.startsWith('asset:')) {
      const assetId = connection.sourceHandle.slice('asset:'.length);
      const asset = sourceNode.data.assets.find((item) => item.id === assetId);
      if (asset) {
        input = { id: asset.id, dataUrl: asset.dataUrl, name: `结果 · ${formatStudioTime(asset.createdAt)}`, origin: 'result' };
      }
    }
    if (!input) return false;
    const nextInput = input;
    if (targetNode.data.inputs.some((item) => item.id === nextInput.id)) return false;
    if (targetNode.data.inputs.length >= MAX_REFERENCE_IMAGES_PER_GENERATOR) {
      setError(`一个生成器最多连接 ${MAX_REFERENCE_IMAGES_PER_GENERATOR} 张参考图。`);
      return false;
    }
    if (getInputBytes([...targetNode.data.inputs, nextInput]) > MAX_REFERENCE_TOTAL_BYTES) {
      setError('这个生成器的参考图合计超过 48 MB，已阻止连接以避免请求体过大。');
      return false;
    }
    latestGeneratorIdRef.current = targetNode.id;
    updateGenerator(targetNode.id, {
      inputs: [...targetNode.data.inputs, nextInput]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .slice(0, MAX_REFERENCE_IMAGES_PER_GENERATOR),
    });
    setError(null);
    return true;
  }, [nodes, updateGenerator]);

  const branchFromResult = useCallback((
    sourceNodeId: string,
    asset: StudioGeneratedAsset,
    prompt = '',
  ) => {
    if (getApproximateDataUrlBytes(asset.dataUrl) > MAX_REFERENCE_TOTAL_BYTES) {
      setError('这张结果图超过二次编辑的安全请求体上限，请先下载压缩后再作为参考图上传。');
      return;
    }
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    const id = createStudioId('generator');
    const input: StudioInputAsset = {
      id: asset.id,
      dataUrl: asset.dataUrl,
      name: `结果 · ${formatStudioTime(asset.createdAt)}`,
      origin: 'result',
    };
    const position = {
      x: (sourceNode?.position.x ?? 820) + 520,
      y: (sourceNode?.position.y ?? 120) + 90,
    };
    latestGeneratorIdRef.current = id;
    setNodes((current) => [
      ...current,
      createGeneratorNode(id, position, {
        title: '二次编辑',
        prompt,
        ratio: asset.ratio,
        inputs: [input],
      }),
    ]);
    setEdges((current) => [
      ...current,
      {
        id: createStudioId('edge'),
        source: sourceNodeId,
        sourceHandle: `asset:${asset.id}`,
        target: id,
        targetHandle: 'references',
        type: 'smoothstep',
      },
    ]);
    setError(null);
  }, [nodes, setEdges, setNodes]);

  const generate = useCallback(async (generatorId: string) => {
    const generator = nodes.find((node) => node.id === generatorId);
    if (!generator || !isGeneratorNode(generator) || generator.data.status === 'running') return;
    const cleanPrompt = generator.data.prompt.trim();
    if (!cleanPrompt) {
      setError('先在生成器节点里描述你要的商品、场景或修改方向。');
      return;
    }
    if (addingReferencesRef.current) {
      setError('参考图仍在读取和保存。为避免付费请求漏带素材，请等保存完成后再生成。');
      return;
    }
    if (imageModelRisk && !highCostAcknowledged) {
      setError('当前是高费用模型，请先勾选顶部的费用确认。');
      return;
    }

    let runtimeSettings: GatewaySettings;
    try {
      runtimeSettings = normalizeSettings(settings, { requireApiKey: true });
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : '统一 API 设置无效。');
      return;
    }

    if (generatingNodeIdsRef.current.has(generatorId)) return;
    if (generatingNodeIdsRef.current.size > 0) {
      setError('已有一个生图批次正在运行。为控制并发与费用，请等它完成后再启动下一个节点。');
      return;
    }
    generatingNodeIdsRef.current.add(generatorId);
    updateGenerator(generatorId, {
      status: 'running',
      completed: 0,
      failed: 0,
      error: undefined,
    });
    let batchOperationIds: string[] = [];
    try {
    const resultNodeId = createStudioId('batch');
    const batchId = createStudioId('studio');
    const count = generator.data.count;
    const historyTaskId = createHistoryTaskId();
    const projectStartedAt = Date.now();
    const runSlots = Array.from({ length: count }, (_, index) => ({
      assetId: createStudioId('asset'),
      operationId: `${batchId}_${index + 1}`,
      index,
    }));
    batchOperationIds = runSlots.map((slot) => slot.operationId);
    batchOperationIds.forEach((operationId) => activeOperationIdsRef.current.add(operationId));
    try {
      await postHistory('upsert-task', {
        task: {
          id: historyTaskId,
          name: `生图批次 · ${formatStudioTime(projectStartedAt)}`,
          language: '文生图',
          ratio: generator.data.ratio,
          mode: 'generate',
          settingsSummary: {
            imageModel: runtimeSettings.imageModel,
            textModel: runtimeSettings.textModel,
            apiBaseUrl: runtimeSettings.apiBaseUrl,
            maxParallelTasks: Math.min(2, runtimeSettings.maxParallelTasks),
            imageRequestTimeoutMs: runtimeSettings.imageRequestTimeoutMs,
            skipOcr: runtimeSettings.skipOcr,
          },
        },
        images: runSlots.map((slot) => ({
          id: slot.assetId,
          name: `xobi-生图-${projectStartedAt}-${slot.index + 1}.png`,
          relativePath: `xobi-生图-${projectStartedAt}-${slot.index + 1}.png`,
          outputRelativePath: `xobi-生图-${projectStartedAt}-${slot.index + 1}.png`,
          groupLabel: '生图工作台',
          status: 'generating',
          phase: 'direct_image',
          sourceKind: 'file',
          pathKey: slot.assetId,
          generationOperationId: slot.operationId,
          startedAt: Date.now(),
        })),
      });
    } catch (historyError) {
      const message = `本地恢复记录创建失败，已在付费请求前停止：${historyError instanceof Error ? historyError.message : '无法写入历史。'}`;
      updateGenerator(generatorId, { status: 'failed', error: message });
      setError(message);
      return;
    }
    const resultPosition = {
      x: generator.position.x + 520,
      y: generator.position.y,
    };
    const resultData: StudioResultNodeData = {
      kind: 'result',
      title: `结果批次 · ${formatStudioTime(Date.now())}`,
      assets: [],
      expectedCount: count,
      failedCount: 0,
      failedSlots: [],
      status: 'running',
    };

    setNodes((current) => [
      ...current.map((node) => (
        node.id === generatorId && isGeneratorNode(node)
          ? { ...node, data: { ...node.data, status: 'running' as const, completed: 0, failed: 0, error: undefined } }
          : node
      )),
      { id: resultNodeId, type: 'result', position: resultPosition, data: resultData },
    ]);
    setEdges((current) => [
      ...current,
      {
        id: createStudioId('edge'),
        source: generatorId,
        sourceHandle: 'results',
        target: resultNodeId,
        targetHandle: 'batch',
        type: 'smoothstep',
      },
    ]);
    setError(null);

    let completed = 0;
    let failed = 0;
    let nextIndex = 0;
    const failures: string[] = [];

    const runOne = async (index: number) => {
      const slot = runSlots[index];
      const operationId = slot.operationId;
      const contextualInstruction = generator.data.inputs.length > 0
        ? `已附上 ${generator.data.inputs.length} 张参考素材。把它们作为本次编辑的视觉上下文：保持用户没有要求改变的商品主体、材质、颜色、标识与关键结构，只按描述调整画面。`
        : '生成原创视觉；不要添加水印、虚构品牌或不可读文字。';
      const parts = [
        {
          text: [
            cleanPrompt,
            `输出画幅：${generator.data.ratio}。请按该比例完成画面构图。`,
            contextualInstruction,
            count > 1 ? `这是同批次第 ${index + 1} 张，请在不偏离要求的前提下提供有意义的构图变化。` : '',
          ].filter(Boolean).join('\n\n'),
        },
        ...generator.data.inputs.map((input) => ({ inlineData: inlineDataFromDataUrl(input.dataUrl) })),
      ];
      const response = await fetchGenerateApiResponse({
        settings: runtimeSettings,
        model: runtimeSettings.imageModel,
        parts,
        requestKind: 'image',
        operationId,
        allowImageTransportFallback: false,
        debugLabel: generator.data.inputs.length > 0 ? '生图工作台 / 二次编辑' : '生图工作台 / 文生图',
        generationConfig: {
          aspectRatio: generator.data.ratio,
          imageConfig: { aspectRatio: generator.data.ratio },
        },
      });
      const payload = await response.json().catch(() => ({})) as GatewayGenerateResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `第 ${index + 1} 张请求失败 (${response.status})`);
      }
      const createdAt = Date.now();
      const asset: StudioGeneratedAsset = {
        id: slot.assetId,
        operationId,
        historyTaskId,
        historyTaskStartedAt: projectStartedAt,
        dataUrl: readGeneratedImage(payload),
        prompt: cleanPrompt,
        ratio: generator.data.ratio,
        saved: false,
        createdAt,
      };
      try {
        await saveToHistory(asset);
        asset.saved = true;
        await acknowledgeGenerateJobFamily(operationId);
      } catch (historyError) {
        asset.saveError = historyError instanceof Error ? historyError.message : '本地历史保存失败。';
      }
      completed += 1;
      setNodes((current) => current.map((node) => {
        if (node.id === resultNodeId && isResultNode(node)) {
          return {
            ...node,
            data: {
              ...node.data,
              assets: [...node.data.assets, asset],
              selectedAssetId: node.data.selectedAssetId ?? asset.id,
            },
          };
        }
        if (node.id === generatorId && isGeneratorNode(node)) {
          return { ...node, data: { ...node.data, completed } };
        }
        return node;
      }));
    };

    const worker = async () => {
      while (nextIndex < count) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          await runOne(index);
        } catch (generateError) {
          failed += 1;
          const failureMessage = generateError instanceof Error ? generateError.message : `第 ${index + 1} 张生成失败。`;
          failures.push(failureMessage);
          try {
            await postHistory('update-image', {
              taskId: historyTaskId,
              imageId: runSlots[index].assetId,
              patch: {
                status: 'error',
                phase: 'error',
                error: failureMessage,
                completedAt: Date.now(),
                generationOperationId: runSlots[index].operationId,
              },
            });
          } catch {
            // The paid job remains in the idempotent job store for recovery.
          }
          setNodes((current) => current.map((node) => {
            if (node.id === resultNodeId && isResultNode(node)) {
              const failedSlot: StudioFailedSlot = {
                assetId: runSlots[index].assetId,
                operationId: runSlots[index].operationId,
                historyTaskId,
                historyTaskStartedAt: projectStartedAt,
                index,
                prompt: cleanPrompt,
                ratio: generator.data.ratio,
                error: failureMessage,
              };
              return {
                ...node,
                data: {
                  ...node.data,
                  failedCount: failed,
                  failedSlots: [
                    ...node.data.failedSlots.filter((item) => item.operationId !== failedSlot.operationId),
                    failedSlot,
                  ],
                },
              };
            }
            if (node.id === generatorId && isGeneratorNode(node)) {
              return { ...node, data: { ...node.data, failed } };
            }
            return node;
          }));
        }
      }
    };

    const concurrency = Math.max(1, Math.min(2, runtimeSettings.maxParallelTasks, count));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const finalStatus = completed === count ? 'done' : completed > 0 ? 'partial' : 'failed';
    setNodes((current) => current.map((node) => {
      if (node.id === resultNodeId && isResultNode(node)) {
        return { ...node, data: { ...node.data, status: finalStatus, failedCount: failed } };
      }
      if (node.id === generatorId && isGeneratorNode(node)) {
        return {
          ...node,
          data: {
            ...node.data,
            status: finalStatus,
            completed,
            failed,
            error: failures.length ? failures[0] : undefined,
          },
        };
      }
      return node;
    }));
    if (failures.length) {
      setError(`${completed} 张成功，${failed} 张失败。成功结果已保留，失败请求没有自动重发。`);
    }
    void loadStudioHistory();
    } catch (unexpectedError) {
      const message = unexpectedError instanceof Error ? unexpectedError.message : '生图批次启动失败。';
      updateGenerator(generatorId, { status: 'failed', error: message });
      setError(message);
    } finally {
      batchOperationIds.forEach((operationId) => activeOperationIdsRef.current.delete(operationId));
      generatingNodeIdsRef.current.delete(generatorId);
    }
  }, [highCostAcknowledged, imageModelRisk, loadStudioHistory, nodes, saveToHistory, setEdges, setNodes, settings, updateGenerator]);

  const retryArchive = useCallback(async (asset: StudioGeneratedAsset) => {
    try {
      await saveToHistory(asset);
      await acknowledgeGenerateJobFamily(asset.operationId);
      setNodes((current) => current.map((node) => (
        isResultNode(node)
          ? {
              ...node,
              data: {
                ...node.data,
                assets: node.data.assets.map((item) => item.id === asset.id
                  ? { ...item, saved: true, saveError: undefined }
                  : item),
              },
            }
          : node
      )));
      setError(null);
      void loadStudioHistory();
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : '重新归档失败。');
    }
  }, [loadStudioHistory, saveToHistory, setNodes]);

  const recoverSlot = useCallback(async (resultNodeId: string, slot: StudioFailedSlot) => {
    if (recoveringOperationIdsRef.current.has(slot.operationId)) return;
    recoveringOperationIdsRef.current.add(slot.operationId);
    updateResult(resultNodeId, { status: 'running' });
    setError(null);
    try {
      const response = await recoverGenerateApiResponse(slot.operationId);
      const payload = await response.json().catch(() => ({})) as GatewayGenerateResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `原任务恢复失败 (${response.status})`);
      }
      const asset: StudioGeneratedAsset = {
        id: slot.assetId,
        operationId: slot.operationId,
        historyTaskId: slot.historyTaskId,
        historyTaskStartedAt: slot.historyTaskStartedAt,
        dataUrl: readGeneratedImage(payload),
        prompt: slot.prompt,
        ratio: slot.ratio,
        saved: false,
        createdAt: Date.now(),
      };
      try {
        await saveToHistory(asset);
        asset.saved = true;
        await acknowledgeGenerateJobFamily(slot.operationId);
      } catch (historyError) {
        asset.saveError = historyError instanceof Error ? historyError.message : '本地历史保存失败。';
      }
      setNodes((current) => current.map((node) => {
        if (node.id !== resultNodeId || !isResultNode(node)) return node;
        const failedSlots = node.data.failedSlots.filter((item) => item.operationId !== slot.operationId);
        return {
          ...node,
          data: {
            ...node.data,
            assets: [...node.data.assets, asset],
            selectedAssetId: asset.id,
            failedSlots,
            failedCount: failedSlots.length,
            status: failedSlots.length > 0 ? 'partial' : 'done',
          },
        };
      }));
      if (asset.saveError) setError(`图片已恢复，但本地归档失败：${asset.saveError}`);
      void loadStudioHistory();
    } catch (recoverError) {
      const message = recoverError instanceof Error ? recoverError.message : '原任务恢复失败。';
      setNodes((current) => current.map((node) => {
        if (node.id !== resultNodeId || !isResultNode(node)) return node;
        return {
          ...node,
          data: {
            ...node.data,
            status: node.data.assets.length > 0 ? 'partial' : 'failed',
            failedSlots: node.data.failedSlots.map((item) => item.operationId === slot.operationId
              ? { ...item, error: message }
              : item),
          },
        };
      }));
      setError(`${message} 本次只查询了原任务，没有重新提交生图。`);
    } finally {
      recoveringOperationIdsRef.current.delete(slot.operationId);
    }
  }, [loadStudioHistory, saveToHistory, setNodes, updateResult]);

  const continueFromHistory = useCallback(async (historyItem: StudioHistoryItem) => {
    try {
      const response = await fetch(
        `/api/history?taskId=${encodeURIComponent(historyItem.taskId)}&includeData=1&imageId=${encodeURIComponent(historyItem.imageId)}&kind=result`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? '作品读取失败。');
      const image = payload.image as HistoryImageRecord | undefined;
      const dataUrl = image?.resultDataUrl ?? image?.originalDataUrl;
      if (!dataUrl) throw new Error('该作品图片已不可用。');
      const input: StudioInputAsset = {
        id: createStudioId('history'),
        dataUrl,
        name: `历史作品 · ${historyItem.name}`,
        origin: 'history',
      };
      const sourceNode = createSourceNode(input, { x: 60, y: 120 + nodes.length * 30 });
      const generatorId = createStudioId('generator');
      latestGeneratorIdRef.current = generatorId;
      setNodes((current) => [
        ...current,
        sourceNode,
        createGeneratorNode(generatorId, { x: 380, y: 140 + current.length * 24 }, {
          title: '历史作品编辑',
          ratio: normalizeStudioRatio(historyItem.ratio),
          inputs: [input],
        }),
      ]);
      setEdges((current) => [
        ...current,
        {
          id: createStudioId('edge'),
          source: sourceNode.id,
          sourceHandle: 'image',
          target: generatorId,
          targetHandle: 'references',
          type: 'smoothstep',
        },
      ]);
      setStudioHistoryOpen(false);
      setError(null);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : '作品读取失败。');
    }
  }, [nodes.length, setEdges, setNodes]);

  const flowActions = useMemo(() => ({
    updateGenerator,
    generate: (nodeId: string) => { void generate(nodeId); },
    removeNode,
    selectResult: (nodeId: string, assetId: string) => updateResult(nodeId, { selectedAssetId: assetId }),
    branchFromResult,
    download: (asset: StudioGeneratedAsset) => downloadDataUrl(
      asset.dataUrl,
      `xobi-生图-${asset.createdAt}.${getDataUrlExtension(asset.dataUrl)}`,
    ),
    retryArchive: (asset: StudioGeneratedAsset) => { void retryArchive(asset); },
    recoverSlot: (nodeId: string, slot: StudioFailedSlot) => { void recoverSlot(nodeId, slot); },
  }), [branchFromResult, generate, recoverSlot, removeNode, retryArchive, updateGenerator, updateResult]);

  return (
    <div className="ui-modal-backdrop ui-image-studio-root fixed inset-0 z-[74] flex">
      <section className="ui-image-studio-canvas flex min-h-0 w-full flex-col overflow-hidden" aria-label="xobi 生图工作台">
        <header className="ui-studio-header">
          <span className="ui-studio-brand"><WandSparkles className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">生图画布</p>
            <p className="ui-studio-subtitle text-[11px]">拖动节点 · 连接参考 · 从结果继续编辑</p>
          </div>
          <div className="ui-studio-header-actions">
            {imageModelRisk && (
              <label className="ui-studio-cost-check">
                <input type="checkbox" checked={highCostAcknowledged} onChange={(event) => setHighCostAcknowledged(event.target.checked)} />
                <span>确认高费用模型</span>
              </label>
            )}
            <button type="button" onClick={addGenerator} className="ui-studio-header-button"><Plus className="h-3.5 w-3.5" />生成器</button>
            <button type="button" onClick={() => referenceInputRef.current?.click()} className="ui-studio-header-button"><ImagePlus className="h-3.5 w-3.5" />参考图</button>
            <button type="button" onClick={() => { setStudioHistoryOpen(true); void loadStudioHistory(); }} disabled={isGenerating} className="ui-studio-header-button"><Images className="h-3.5 w-3.5" />作品</button>
            <button type="button" onClick={onOpenSettings} className="ui-studio-header-icon" aria-label="统一设置"><Settings className="h-4 w-4" /></button>
            <button type="button" onClick={onClose} disabled={isGenerating} className="ui-studio-header-icon" aria-label="关闭生图工作台"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <main className="ui-studio-flow-shell">
          <ImageStudioFlow
            nodes={nodes}
            edges={edges}
            actions={flowActions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onEdgesUpdate={setEdges}
            onConnectAsset={connectAsset}
            onDropFiles={(files, position) => { void addReferences(files, position); }}
            onCanvasClick={() => setError(null)}
            onActivateNode={(nodeId) => {
              const node = nodes.find((candidate) => candidate.id === nodeId);
              if (node && isGeneratorNode(node)) latestGeneratorIdRef.current = node.id;
            }}
          />
          <div className="ui-studio-canvas-hint">
            <span><Sparkles className="h-3 w-3" />框选节点</span>
            <span>滚轮缩放</span>
            <span>中键移动画布</span>
            <span>每张图片独立请求，不自动重发</span>
          </div>
          {error && (
            <div className="ui-studio-toast" role="status">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="关闭提示"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </main>

        <input
          ref={referenceInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void addReferences(event.target.files);
            event.currentTarget.value = '';
          }}
        />

        {studioHistoryOpen && (
          <div className="ui-modal-backdrop absolute inset-0 z-30 flex items-center justify-center p-4 backdrop-blur-xl" onMouseDown={(event) => { if (event.target === event.currentTarget) setStudioHistoryOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-label="生图作品库" className="ui-modal-panel flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl">
              <header className="flex min-h-16 items-center gap-3 border-b border-[var(--xobi-border)] px-5">
                <div><p className="text-sm font-semibold">作品库</p><p className="mt-0.5 text-xs text-[var(--xobi-muted)]">选择一张作品，会创建新的参考节点和编辑分支。</p></div>
                <button type="button" onClick={() => void loadStudioHistory()} disabled={studioHistoryLoading} className="ui-icon-action ml-auto h-10 min-h-10 w-10 min-w-10" aria-label="刷新作品库"><RefreshCw className={cn('h-3.5 w-3.5', studioHistoryLoading && 'animate-spin')} /></button>
                <button type="button" onClick={() => setStudioHistoryOpen(false)} className="ui-icon-action h-10 min-h-10 w-10 min-w-10" aria-label="关闭作品库"><X className="h-4 w-4" /></button>
              </header>
              <div className="min-h-0 overflow-y-auto p-4 md:p-5">
                {studioHistory.length === 0 ? (
                  <div className="flex min-h-56 items-center justify-center text-center text-sm text-[var(--xobi-muted)]">{studioHistoryLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取作品…</> : '还没有已归档的生图作品。'}</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {studioHistory.map((item) => (
                      <button key={`${item.taskId}-${item.imageId}`} type="button" onClick={() => void continueFromHistory(item)} className="ui-image-studio-result overflow-hidden rounded-xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] text-left">
                        <img src={item.previewUrl} alt={item.name} className="ui-checkerboard aspect-square w-full bg-[var(--xobi-canvas)] object-contain" />
                        <span className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs text-[var(--xobi-muted)]"><span className="truncate">{item.name}</span><span className="shrink-0 tabular-nums">{item.ratio}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
