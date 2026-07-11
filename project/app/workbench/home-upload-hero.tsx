'use client';

import { FolderOpen, Plus, UploadCloud } from 'lucide-react';
import {
  useState,
  type DragEvent,
} from 'react';

interface HomeUploadHeroProps {
  onSelectImages: () => void;
  onSelectFolder: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  disabled?: boolean;
}

export function HomeUploadHero({
  onSelectImages,
  onSelectFolder,
  onDrop,
  disabled = false,
}: HomeUploadHeroProps) {
  const [isDragging, setIsDragging] = useState(false);

  const enterDropZone = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const leaveDropZone = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextTarget)) setIsDragging(false);
  };

  const finishDrop = (event: DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
    onDrop(event);
  };

  return (
    <div
      className="ui-home-stage"
      data-dragging={isDragging ? 'true' : 'false'}
      data-busy={disabled ? 'true' : 'false'}
      aria-busy={disabled}
      onDragEnter={enterDropZone}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={leaveDropZone}
      onDrop={finishDrop}
    >
      <div className="ui-home-quiet-actions">
        <button
          type="button"
          onClick={onSelectImages}
          disabled={disabled}
          className="ui-home-pick-action"
          data-home-action="images"
        >
          <span className="ui-home-action-dot" aria-hidden="true" />
          <Plus className="ui-home-action-icon" aria-hidden="true" />
          <span>{disabled ? '读取中' : '选择图片'}</span>
        </button>
        <button
          type="button"
          onClick={onSelectFolder}
          disabled={disabled}
          className="ui-home-folder-action"
          data-home-action="folder"
        >
          <span className="ui-home-action-dot" aria-hidden="true" />
          <FolderOpen className="ui-home-action-icon" aria-hidden="true" />
          <span>选择文件夹</span>
        </button>
      </div>

      <span className="ui-home-drag-caption" aria-hidden="true">拖入图片</span>

      <div className="ui-home-drop-state" data-active={isDragging ? 'true' : 'false'} aria-hidden="true">
        <span className="ui-home-drop-dot" />
        <UploadCloud className="ui-home-drop-icon" />
        <strong>松手</strong>
      </div>

      <span className="sr-only" aria-live="polite">
        {isDragging ? '已进入图片投放区域，松开鼠标即可导入。' : ''}
      </span>
    </div>
  );
}
