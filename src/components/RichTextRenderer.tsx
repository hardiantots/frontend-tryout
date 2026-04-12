import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';

const KATEX_OPTIONS = {
  trust: true,
  strict: false,
  throwOnError: false,
  errorColor: '#ef4444',
  macros: {
    // Sets
    '\\RR': '\\mathbb{R}',
    '\\NN': '\\mathbb{N}',
    '\\ZZ': '\\mathbb{Z}',
    '\\QQ': '\\mathbb{Q}',
    '\\CC': '\\mathbb{C}',
    // Combinatorics
    '\\Perm': '\\mathrm{P}',
    '\\Comb': '\\mathrm{C}',
    '\\nPr': '{}^{#1}\\mathrm{P}_{#2}',
    '\\nCr': '{}^{#1}\\mathrm{C}_{#2}',
    // Absolute value, floor, ceil
    '\\abs': '\\left|#1\\right|',
    '\\floor': '\\left\\lfloor #1 \\right\\rfloor',
    '\\ceil': '\\left\\lceil #1 \\right\\rceil',
    // Probability
    '\\Prob': '\\mathrm{P}\\left(#1\\right)',
    '\\Expected': '\\mathrm{E}\\left[#1\\right]',
    '\\Var': '\\mathrm{Var}\\left(#1\\right)',
    // Vectors / Matrices
    '\\vec': '\\mathbf{#1}',
    '\\mat': '\\mathbf{#1}',
    '\\det': '\\mathrm{det}',
    '\\rank': '\\mathrm{rank}',
    // Trigonometry
    '\\sen': '\\sin',
    '\\tg': '\\tan',
    '\\cotg': '\\cot',
    '\\cosec': '\\csc',
    // Limits / Calculus
    '\\lmark': '\\lim_{#1 \\to #2}',
    '\\dd': '\\,\\mathrm{d}',
    '\\dv': '\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}',
    '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
    // Statistics
    '\\mean': '\\bar{#1}',
    '\\median': '\\tilde{#1}',
    // General
    '\\deg': '^{\\circ}',
    '\\persen': '\\%',
  },
};

interface RichTextRendererProps {
  content: string;
  className?: string;
}

export function RichTextRenderer({ content, className = '' }: RichTextRendererProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-sm max-w-none text-slate-800 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{
          // Custom renderers to ensure markdown shapes beautifully without affecting global styles unnecessarily
          p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-2 last:mb-0" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-2 last:mb-0" {...props} />,
          li: ({ node, ...props }) => <li className="mb-1 last:mb-0" {...props} />,
          a: ({ node, ...props }) => (
            <a className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-slate-300 text-sm" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border border-slate-300 bg-slate-100 px-3 py-1.5 text-left font-semibold" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-slate-300 px-3 py-1.5" {...props} />
          ),
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !content.includes('\n');
            return isInline ? (
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-teal-800" {...props}>
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
