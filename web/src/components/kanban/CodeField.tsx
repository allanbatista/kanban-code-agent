import { useRef, useCallback } from 'react';
import { CodeHighlighter } from './SyntaxHighlighter';

interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

export function CodeField({
  value,
  onChange,
  language = 'markdown',
  placeholder = 'Code...',
  minHeight = '280px',
  className = '',
}: CodeFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }, []);

  return (
    <div
      className={`relative h-full overflow-hidden rounded-lg border border-gray-800 ${className}`}
      style={{ minHeight }}
    >
      {/* Highlighted layer */}
      <div
        ref={highlightRef}
        className="pointer-events-none absolute inset-0 overflow-auto p-3"
        aria-hidden
      >
        <CodeHighlighter language={language} code={value || ' '} />
      </div>

      {/* Textarea layer */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        className="relative h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-[1.5] text-transparent caret-gray-100 placeholder:text-gray-700 focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
