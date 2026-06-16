import { cn } from '@/lib/utils';
import { CodeBlock } from './CodeBlock';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

function renderLine(line: string, index: number) {
  if (line.startsWith('# ')) {
    return <h1 key={index} className="text-xl font-bold mb-3 mt-5 first:mt-0 text-foreground">{line.slice(2)}</h1>;
  }
  if (line.startsWith('## ')) {
    return <h2 key={index} className="text-lg font-semibold mb-2 mt-4 text-foreground/95">{line.slice(3)}</h2>;
  }
  if (line.startsWith('### ')) {
    return <h3 key={index} className="text-base font-medium mb-1.5 mt-3 text-foreground/90">{line.slice(4)}</h3>;
  }
  if (line.startsWith('- ')) {
    return <li key={index} className="ml-5 text-sm text-muted-foreground/80 list-disc marker:text-primary/50">{line.slice(2)}</li>;
  }
  if (line.startsWith('> ')) {
    return <blockquote key={index} className="border-l-[3px] border-primary/40 bg-primary/5 py-1 pl-4 my-2 rounded-r text-sm italic text-muted-foreground/70">{line.slice(2)}</blockquote>;
  }
  if (line.startsWith('```') && line.length > 3) {
    return null;
  }
  if (line === '') {
    return <br key={index} />;
  }
  return <p key={index} className="text-sm text-foreground/85 leading-relaxed">{line}</p>;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';

  lines.forEach((line, index) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock key={`code-${index}`} code={codeBlockLines.join('\n')} language={codeBlockLang} className="my-2" />
        );
        codeBlockLines = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      return;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }
    const rendered = renderLine(line, index);
    if (rendered) elements.push(rendered);
  });

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <CodeBlock key="code-end" code={codeBlockLines.join('\n')} language={codeBlockLang} className="my-2" />
    );
  }

  return <div className={cn('space-y-0.5', className)}>{elements}</div>;
}
