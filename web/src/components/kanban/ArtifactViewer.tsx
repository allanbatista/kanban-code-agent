import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Image as ImageIcon, Save } from 'lucide-react';
import { api } from '@/api/client';
import { apiTaskToTask } from '@/api/adapter';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useKanbanStore } from '@/stores/kanbanStore';
import type { Artifact } from '@/types/task';

export type ArtifactRenderKind = 'markdown' | 'text' | 'image' | 'pdf' | 'download';

const markdownTypes = new Set(['markdown', 'md', 'mdx']);
const imageTypes = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const textTypes = new Set([
  'c',
  'cpp',
  'css',
  'csv',
  'go',
  'h',
  'html',
  'java',
  'javascript',
  'js',
  'json',
  'py',
  'rs',
  'sh',
  'sql',
  'text',
  'ts',
  'tsx',
  'txt',
  'typescript',
  'xml',
  'yaml',
  'yml',
]);

export function artifactDisplayName(path: string): string {
  return path.split('/').pop() ?? path;
}

function extensionOf(path: string): string {
  const name = artifactDisplayName(path);
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function artifactRenderKind(artifact: Artifact): ArtifactRenderKind {
  const type = artifact.file_type.toLowerCase();
  const extension = extensionOf(artifact.path);
  if (markdownTypes.has(type) || markdownTypes.has(extension)) return 'markdown';
  if (imageTypes.has(type) || imageTypes.has(extension)) return 'image';
  if (type === 'pdf' || extension === 'pdf') return 'pdf';
  if (textTypes.has(type) || textTypes.has(extension)) return 'text';
  return 'download';
}

function isTextKind(kind: ArtifactRenderKind): boolean {
  return kind === 'markdown' || kind === 'text';
}

interface ArtifactViewerProps {
  taskId: string;
  artifact: Artifact;
}

export function ArtifactViewer({ taskId, artifact }: ArtifactViewerProps) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = useMemo(() => artifactRenderKind(artifact), [artifact]);
  const editable = isTextKind(kind);
  const name = artifactDisplayName(artifact.path);
  const url = api.artifactUrl(taskId, artifact.path);

  useEffect(() => {
    if (!open || !editable) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getArtifactText(taskId, artifact.path)
      .then((value) => {
        if (cancelled) return;
        setContent(value);
        setDraft(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.path, editable, open, taskId]);

  const handleSave = async () => {
    if (!editable || draft === content) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateArtifactText(taskId, artifact.path, draft);
      useKanbanStore.getState().upsertTask(apiTaskToTask(updated));
      setContent(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mt-1 w-full justify-start border-primary/30 bg-primary/5 px-2 text-xs text-primary hover:bg-primary/10"
        title={artifact.description}
      >
        {kind === 'image' ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
        <span className="truncate">{name}</span>
        <span className="text-[10px] text-muted-foreground/70">{artifact.file_type}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-w-5xl grid-rows-none flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border/60 p-4 pr-12">
            <DialogTitle className="truncate text-base">{name}</DialogTitle>
            <DialogDescription className="truncate">{artifact.description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 p-4">
            {editable ? (
              <Tabs defaultValue="view" className="flex h-full flex-col">
                <TabsList className="w-fit">
                  <TabsTrigger value="view">Ver</TabsTrigger>
                  <TabsTrigger value="edit">Editar</TabsTrigger>
                </TabsList>
                <TabsContent value="view" className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-background/70 p-4">
                  <TextPreview kind={kind} loading={loading} content={content} />
                </TabsContent>
                <TabsContent value="edit" className="min-h-0 flex-1">
                  <Textarea
                    value={draft}
                    disabled={loading || saving}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-full min-h-[55vh] resize-none font-mono text-xs"
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <AssetPreview kind={kind} name={name} url={url} />
            )}
          </div>

          <DialogFooter className="items-center border-t border-border/60 p-4">
            {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button asChild variant="outline" size="sm">
              <a href={url} download>
                <Download className="h-4 w-4" />
                Baixar
              </a>
            </Button>
            {editable && (
              <Button size="sm" onClick={handleSave} disabled={loading || saving || draft === content}>
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TextPreview({ kind, loading, content }: { kind: ArtifactRenderKind; loading: boolean; content: string }) {
  if (loading) return <div className="text-sm text-muted-foreground">Carregando...</div>;
  if (kind === 'markdown') {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }
  return <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{content}</pre>;
}

function AssetPreview({ kind, name, url }: { kind: ArtifactRenderKind; name: string; url: string }) {
  if (kind === 'image') {
    return (
      <div className="flex h-full min-h-[55vh] items-center justify-center overflow-auto rounded-md border border-border/60 bg-background/70 p-3">
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (kind === 'pdf') {
    return <iframe title={name} src={url} className="h-full min-h-[65vh] w-full rounded-md border border-border/60 bg-background" />;
  }
  return (
    <div className="flex h-full min-h-[55vh] items-center justify-center rounded-md border border-border/60 bg-background/70 text-sm text-muted-foreground">
      Preview indisponível para este tipo.
    </div>
  );
}
