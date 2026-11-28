'use client';

import { useState } from 'react';
import { ChevronDown, Turtle } from 'lucide-react';
import { Text } from '@/components/Text';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui';
import type {
  WifiCollectorHealth,
  WifiDetectorSnapshot,
  WifiMockScene,
} from '@/lib/types';
import { SLOW_DISTINCT_PER_SEC } from '@/lib/wifi-sense/constants';
import { cn } from '@/lib/utils';

const MOCK_SCENES: { scene: WifiMockScene; label: string }[] = [
  { scene: 'auto', label: 'Random bursts' },
  { scene: 'quiet', label: 'Quiet' },
  { scene: 'inside', label: 'Inside motion' },
  { scene: 'outside', label: 'Outside motion' },
  { scene: 'shift', label: 'Move router (±12 dB)' },
  { scene: 'drop', label: 'Drop link (8 s)' },
];

interface DiagnosticsProps {
  health: WifiCollectorHealth | null;
  snapshot: WifiDetectorSnapshot | null;
  onMockScene: (scene: WifiMockScene) => void;
}

function show(value: string | number | null | undefined, unit = ''): string {
  return value === null || value === undefined ? '—' : `${value}${unit}`;
}

export function Diagnostics({ health, snapshot, onMockScene }: DiagnosticsProps) {
  const [open, setOpen] = useState(false);
  const slow = health !== null && health.distinctPerSec < SLOW_DISTINCT_PER_SEC;

  const rows: [string, string][] = [
    ['Source', show(health?.source)],
    ['Platform', show(health?.platform)],
    ['Sample rate', show(health?.sampleHz, ' Hz')],
    ['Distinct values', show(health?.distinctPerSec, ' /s')],
    ['Last RSSI', show(snapshot?.rssi, ' dBm')],
    ['Noise', show(snapshot?.noise, ' dBm')],
    ['Transmit rate', show(snapshot?.txRate, ' Mbps')],
    ['Gateway (keepalive)', show(health?.gateway ?? (health ? 'off' : null))],
  ];

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger
            render={<Button variant='ghost' className='w-full justify-between px-0' />}
          >
            <CardTitle>Diagnostics</CardTitle>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </CollapsibleTrigger>
        </CardHeader>
        {slow && (
          <CardContent className='pb-0'>
            <Alert>
              <Turtle />
              <AlertTitle>Slow updates</AlertTitle>
              <AlertDescription>
                Signal updates slowly on this Mac, so detection will lag by a few seconds.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CollapsibleContent>
          <CardContent className='flex flex-col gap-4 pt-4'>
            <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm'>
              {rows.map(([label, value]) => (
                <div key={label} className='contents'>
                  <dt className='text-muted-foreground'>{label}</dt>
                  <dd className='font-mono'>{value}</dd>
                </div>
              ))}
            </dl>
            {health?.source === 'mock' && (
              <div className='flex flex-col gap-2'>
                <Text variant='label' size='sm'>
                  Mock signal
                </Text>
                <div className='flex flex-wrap gap-2'>
                  {MOCK_SCENES.map(({ scene, label }) => (
                    <Button
                      key={scene}
                      size='sm'
                      variant='outline'
                      onClick={() => onMockScene(scene)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
