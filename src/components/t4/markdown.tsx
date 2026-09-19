'use client'

/**
 * THREAD 4 dashboard — markdown viewer (react-markdown + remark-gfm).
 * GFM is required: the constitution carries pipe tables.
 */

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 border-b border-zinc-800 pb-2 text-xl font-semibold tracking-tight text-amber-200">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight text-zinc-100">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-base font-semibold text-zinc-100">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-zinc-300">{children}</h4>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
  em: ({ children }) => <em className="text-zinc-200">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-amber-400 underline decoration-amber-500/40 underline-offset-2 transition-colors hover:text-amber-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-amber-500/50 bg-amber-500/5 px-4 py-1 text-zinc-300">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-zinc-800" />,
  table: ({ children }) => (
    <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-zinc-900">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-zinc-800/80 last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-zinc-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-300">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-zinc-300">{children}</td>,
  code: ({ className, children }) => (
    <code className={cn('rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-200', className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
      {children}
    </pre>
  ),
}

export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('t4-md text-sm leading-relaxed text-zinc-300', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
