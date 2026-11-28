'use client';

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block';

interface SonarCopyBlockProps {
  title: string;
  /** Plain text shown in the block and copied by its button. */
  value: string;
  /** Shown instead of the value when it's empty. */
  emptyText: string;
}

/** A titled, scrollable monospace block with a one-click copy button. */
export function SonarCopyBlock({ title, value, emptyText }: SonarCopyBlockProps) {
  const empty = value.length === 0;
  return (
    <CodeBlock size='sm'>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={value} disabled={empty} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className='max-h-72' wrap>
        {empty ? emptyText : value}
      </CodeBlockContent>
    </CodeBlock>
  );
}
