'use client';

import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeMarkdownSource } from '@/lib/chat-message-format';

type Props = {
  content: string;
  variant?: 'user' | 'assistant';
};

const assistantComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 hover:opacity-90"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border bg-muted/60">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-border px-2 py-1.5">{children}</td>,
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes('language-'));
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
};

export function ChatMessageContent({ content, variant = 'assistant' }: Props) {
  if (variant === 'user') {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  const source = normalizeMarkdownSource(content);
  if (!source) {
    return <span className="text-muted-foreground">（无可见回复内容）</span>;
  }

  return (
    <div className="chat-markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantComponents}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
