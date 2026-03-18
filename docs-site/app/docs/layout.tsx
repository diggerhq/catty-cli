import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: 'Catty',
      }}
      links={[
        {
          text: 'GitHub',
          url: 'https://github.com/diggerhq/catty-cli',
        },
        {
          text: 'npm',
          url: 'https://www.npmjs.com/package/@diggerhq/catty',
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
