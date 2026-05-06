import { useEffect } from 'react';
import { useToastContext } from '@librechat/client';
import { EToolResources } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useDeleteFilesMutation } from '~/data-provider';
import { useFileDeletion, useFileStatusStream } from '~/hooks/Files';
import { useChatContext } from '~/Providers';
import FileContainer from './FileContainer';
import SessionFileChip, { SessionFile } from './SessionFileChip';
import { useLocalize } from '~/hooks';
import { logger } from '~/utils';
import Image from './Image';

export default function FileRow({
  files: _files,
  setFiles,
  abortUpload,
  setFilesLoading,
  assistant_id,
  agent_id,
  tool_resource,
  fileFilter,
  isRTL = false,
  Wrapper,
}: {
  files: Map<string, ExtendedFile> | undefined;
  abortUpload?: () => void;
  setFiles: React.Dispatch<React.SetStateAction<Map<string, ExtendedFile>>>;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fileFilter?: (file: ExtendedFile) => boolean;
  assistant_id?: string;
  agent_id?: string;
  tool_resource?: EToolResources;
  isRTL?: boolean;
  Wrapper?: React.FC<{ children: React.ReactNode }>;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? null;
  // Phase 3 Track 2 wrote `Conversation.session_files` server-side. The type
  // isn't surfaced on TConversation (data-provider), so we cast defensively.
  const initialSessionFiles =
    (conversation as { session_files?: SessionFile[] } | undefined | null)?.session_files ?? [];

  const files = Array.from(_files?.values() ?? []).filter((file) =>
    fileFilter ? fileFilter(file) : true,
  );

  // Phase 2 — single SSE subscription per FileRow. Enabled as soon as a
  // conversation context exists (codex review F5). Gating on files.length /
  // initialSessionFiles.length would miss the FIRST session_file event for
  // a code-interpreter run that produces output before any user upload —
  // breaking UAT S7 live behavior.
  const { pathStatusByFileId, sessionFiles } = useFileStatusStream({
    enabled: Boolean(conversationId),
    conversationId,
    initialSessionFiles,
  });

  const { mutateAsync } = useDeleteFilesMutation({
    onMutate: async () =>
      logger.log(
        'agents',
        'Deleting files: agent_id, assistant_id, tool_resource',
        agent_id,
        assistant_id,
        tool_resource,
      ),
    onSuccess: () => {
      console.log('Files deleted');
    },
    onError: (error) => {
      console.log('Error deleting files:', error);
    },
  });

  const { deleteFile } = useFileDeletion({ mutateAsync, agent_id, assistant_id, tool_resource });

  useEffect(() => {
    if (files.length === 0) {
      setFilesLoading(false);
      return;
    }

    if (files.some((file) => file.progress < 1)) {
      setFilesLoading(true);
      return;
    }

    if (files.every((file) => file.progress === 1)) {
      setFilesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  if (files.length === 0 && sessionFiles.length === 0) {
    return null;
  }

  const renderSessionFiles = () => {
    if (sessionFiles.length === 0) return null;
    return (
      <div
        className="flex flex-wrap gap-1"
        style={{ width: '100%', maxWidth: '100%', marginTop: '4px' }}
        data-testid="session-files-row"
      >
        {sessionFiles.map((sf) => (
          <SessionFileChip key={`${sf.session_id}-${sf.file_id}`} sessionFile={sf} />
        ))}
      </div>
    );
  };

  const renderFiles = () => {
    const rowStyle = isRTL
      ? {
          display: 'flex',
          flexDirection: 'row-reverse',
          flexWrap: 'wrap',
          gap: '4px',
          width: '100%',
          maxWidth: '100%',
        }
      : {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          width: '100%',
          maxWidth: '100%',
        };

    return (
      <div style={rowStyle as React.CSSProperties}>
        {files
          .reduce(
            (acc, current) => {
              if (!acc.map.has(current.file_id)) {
                acc.map.set(current.file_id, true);
                acc.uniqueFiles.push(current);
              }
              return acc;
            },
            { map: new Map(), uniqueFiles: [] as ExtendedFile[] },
          )
          .uniqueFiles.map((file: ExtendedFile, index: number) => {
            const handleDelete = () => {
              showToast({
                message: localize('com_ui_deleting_file'),
                status: 'info',
              });
              if (abortUpload && file.progress < 1) {
                abortUpload();
              }
              deleteFile({ file, setFiles });
            };
            const isImage = file.type?.startsWith('image') ?? false;

            return (
              <div
                key={index}
                style={{
                  flexBasis: '70px',
                  flexGrow: 0,
                  flexShrink: 0,
                }}
              >
                {isImage ? (
                  <Image
                    url={file.progress === 1 ? file.filepath : (file.preview ?? file.filepath)}
                    onDelete={handleDelete}
                    progress={file.progress}
                    source={file.source}
                  />
                ) : (
                  <FileContainer
                    file={file}
                    onDelete={handleDelete}
                    pathStatus={pathStatusByFileId[file.file_id]}
                  />
                )}
              </div>
            );
          })}
      </div>
    );
  };

  const content = (
    <>
      {files.length > 0 && renderFiles()}
      {renderSessionFiles()}
    </>
  );

  if (Wrapper) {
    return <Wrapper>{content}</Wrapper>;
  }

  return content;
}
