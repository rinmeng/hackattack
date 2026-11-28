'use client';

import { type FormEvent, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Text } from '@/components/Text';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui';
import type { WifiCollectorStatus, WifiConnectionStatus } from '@/lib/types';
import { COLLECTOR_COMMAND, COLLECTOR_MOCK_COMMAND } from '@/lib/wifi-sense/constants';

const CONNECTION_LABELS: Record<WifiConnectionStatus, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  error: 'Not reachable, retrying',
};

const SOURCE_LABELS = {
  corewlan: 'CoreWLAN (real)',
  mock: 'Mock (synthetic)',
} as const;

interface ConnectionPanelProps {
  collectorUrl: string;
  onCollectorUrlChange: (url: string) => boolean;
  connection: WifiConnectionStatus;
  status: WifiCollectorStatus | null;
}

export function ConnectionPanel({
  collectorUrl,
  onCollectorUrlChange,
  connection,
  status,
}: ConnectionPanelProps) {
  const [draft, setDraft] = useState(collectorUrl);
  const [invalid, setInvalid] = useState(false);
  // Keep the field in sync when the saved URL loads from storage.
  const [shownUrl, setShownUrl] = useState(collectorUrl);
  if (shownUrl !== collectorUrl) {
    setShownUrl(collectorUrl);
    setDraft(collectorUrl);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setInvalid(!onCollectorUrlChange(draft));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Collector</CardTitle>
        <CardDescription>
          A small local program that reads this Mac&apos;s Wi-Fi link. It listens on
          127.0.0.1 only.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <form onSubmit={submit} className='flex gap-2'>
          <Input
            aria-label='Collector URL'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={invalid}
            spellCheck={false}
          />
          <Button type='submit' variant='outline'>
            Save
          </Button>
        </form>
        {invalid && (
          <Text variant='muted' size='sm' className='text-destructive'>
            Enter an http:// URL, like http://127.0.0.1:4317
          </Text>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant={connection === 'open' ? 'default' : 'outline'}>
            {CONNECTION_LABELS[connection]}
          </Badge>
          {connection === 'open' && status && (
            <Badge variant='secondary'>{SOURCE_LABELS[status.source]}</Badge>
          )}
        </div>
        {connection !== 'open' && (
          <EmptyState
            icon={PlugZap}
            title='Start the collector'
            description={
              <span className='flex flex-col gap-2'>
                <span>In a terminal, in the repo folder, run:</span>
                <code className='bg-muted px-2 py-1 font-mono text-xs text-foreground'>
                  {COLLECTOR_COMMAND}
                </code>
                <span>No Mac? Use synthetic data:</span>
                <code className='bg-muted px-2 py-1 font-mono text-xs text-foreground'>
                  {COLLECTOR_MOCK_COMMAND}
                </code>
                <span>This page reconnects by itself once it&apos;s running.</span>
              </span>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
