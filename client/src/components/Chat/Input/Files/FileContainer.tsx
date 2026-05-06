import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { getFileType, cn } from '~/utils';
import FilePreview from './FilePreview';
import FileStatusChip, { PathStatus } from './FileStatusChip';
import RemoveFile from './RemoveFile';

const FileContainer = ({
  file,
  overrideType,
  buttonClassName,
  containerClassName,
  onDelete,
  onClick,
  pathStatus,
}: {
  file: Partial<ExtendedFile | TFile>;
  overrideType?: string;
  buttonClassName?: string;
  containerClassName?: string;
  onDelete?: () => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  pathStatus?: PathStatus | null;
}) => {
  const fileType = getFileType(overrideType ?? file.type);
  // Phase 2: prefer live SSE status when present, fall back to the value cached
  // on the file row at upload-time (file.metadata.pathStatus). Pre-Phase-3 rows
  // have neither — FileStatusChip handles undefined defensively.
  const fileMetaPathStatus =
    (file as { metadata?: { pathStatus?: PathStatus } } | undefined)?.metadata?.pathStatus;
  const mergedPathStatus: PathStatus | null | undefined =
    pathStatus != null
      ? { ...(fileMetaPathStatus ?? {}), ...pathStatus }
      : fileMetaPathStatus;

  return (
    <div
      className={cn('group relative inline-block text-sm text-text-primary', containerClassName)}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={file.filename}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border-light bg-surface-hover-alt',
          buttonClassName,
        )}
      >
        <div className="w-56 p-1.5">
          <div className="flex flex-row items-center gap-2">
            <FilePreview file={file} fileType={fileType} className="relative" />
            <div className="overflow-hidden">
              <div className="truncate font-medium" title={file.filename}>
                {file.filename}
              </div>
              <div className="truncate text-text-secondary" title={fileType.title}>
                {fileType.title}
              </div>
            </div>
          </div>
        </div>
      </button>
      {mergedPathStatus !== undefined && (
        <div className="mt-1">
          <FileStatusChip pathStatus={mergedPathStatus} />
        </div>
      )}
      {onDelete && <RemoveFile onRemove={onDelete} />}
    </div>
  );
};

export default FileContainer;
