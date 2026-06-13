import { useState, type ReactNode } from "react";
import { Lexer } from "marked";
import { Check, Copy, LoaderCircle } from "lucide-react";

type Props = {
  text: string;
  pending?: boolean;
  className?: string;
  spinnerSize?: number;
};

export function ChatMessageContent({ text, pending, className = "", spinnerSize = 14 }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyOriginal() {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else copyWithTextarea(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`chat-message-content ${className} ${pending ? "is-pending" : ""}`}>
      <button className="message-copy-button" type="button" aria-label="Copiar markdown original" title="Copiar markdown original" onClick={copyOriginal}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {pending ? <LoaderCircle className="spinner" size={spinnerSize} /> : null}
      <MarkdownMessage text={text} />
    </div>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  return <div className="markdown-message">{renderBlocks(Lexer.lex(text))}</div>;
}

function renderBlocks(tokens: any[]): ReactNode {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "space") return null;
    if (token.type === "paragraph") return <p key={key}>{renderInline(token.tokens || [{ type: "text", text: token.text }])}</p>;
    if (token.type === "heading") {
      const content = renderInline(token.tokens || [{ type: "text", text: token.text }]);
      if (token.depth === 1) return <h1 key={key}>{content}</h1>;
      if (token.depth === 2) return <h2 key={key}>{content}</h2>;
      if (token.depth === 3) return <h3 key={key}>{content}</h3>;
      return <h4 key={key}>{content}</h4>;
    }
    if (token.type === "list") {
      const Tag = token.ordered ? "ol" : "ul";
      return (
        <Tag key={key} start={token.start || undefined}>
          {token.items.map((item: any, itemIndex: number) => (
            <li key={`${key}-item-${itemIndex}`}>
              {item.task ? <input type="checkbox" checked={item.checked} disabled readOnly /> : null}
              {renderBlocks(item.tokens || [{ type: "text", text: item.text }])}
            </li>
          ))}
        </Tag>
      );
    }
    if (token.type === "code") return <pre key={key}><code>{token.text}</code></pre>;
    if (token.type === "blockquote") return <blockquote key={key}>{renderBlocks(token.tokens || [])}</blockquote>;
    if (token.type === "hr") return <hr key={key} />;
    if (token.type === "table") return renderTable(token, key);
    if (token.tokens) return <div key={key}>{renderBlocks(token.tokens)}</div>;
    return <p key={key}>{token.text || token.raw}</p>;
  });
}

function renderInline(tokens: any[]): ReactNode {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "text") return token.tokens ? <span key={key}>{renderInline(token.tokens)}</span> : token.text;
    if (token.type === "escape") return token.text;
    if (token.type === "strong") return <strong key={key}>{renderInline(token.tokens || [{ type: "text", text: token.text }])}</strong>;
    if (token.type === "em") return <em key={key}>{renderInline(token.tokens || [{ type: "text", text: token.text }])}</em>;
    if (token.type === "codespan") return <code key={key}>{token.text}</code>;
    if (token.type === "br") return <br key={key} />;
    if (token.type === "del") return <del key={key}>{renderInline(token.tokens || [{ type: "text", text: token.text }])}</del>;
    if (token.type === "link") {
      const href = safeUrl(token.href);
      const content = renderInline(token.tokens || [{ type: "text", text: token.text }]);
      return href ? <a key={key} href={href} title={token.title || undefined} target="_blank" rel="noreferrer">{content}</a> : <span key={key}>{content}</span>;
    }
    if (token.type === "image") {
      const href = safeUrl(token.href);
      return href ? <img key={key} src={href} alt={token.text || ""} title={token.title || undefined} /> : token.text;
    }
    return token.text || token.raw || null;
  });
}

function renderTable(token: any, key: string) {
  return (
    <table key={key}>
      <thead>
        <tr>{token.header.map((cell: any, index: number) => <th key={`${key}-h-${index}`}>{renderInline(cell.tokens || [{ type: "text", text: cell.text }])}</th>)}</tr>
      </thead>
      <tbody>
        {token.rows.map((row: any[], rowIndex: number) => (
          <tr key={`${key}-r-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${key}-c-${rowIndex}-${cellIndex}`}>{renderInline(cell.tokens || [{ type: "text", text: cell.text }])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function safeUrl(href: string) {
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function copyWithTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
