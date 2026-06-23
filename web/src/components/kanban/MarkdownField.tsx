import { CodeField } from './CodeField';

interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function MarkdownField({ value, onChange }: MarkdownFieldProps) {
  return (
    <CodeField
      value={value}
      onChange={onChange}
      language="markdown"
      placeholder="System prompt (markdown)..."
    />
  );
}
