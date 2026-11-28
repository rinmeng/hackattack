import { Download, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import type { WifiEvent, WifiEventType } from '@/lib/types';
import { DISPLAY_DECIMALS, EVENT_LOG_LIMIT } from '@/lib/wifi-sense/constants';
import { eventsToCsv } from '@/lib/wifi-sense/csv';

const BADGE: Record<WifiEventType, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    motion_start: 'destructive',
    motion_end: 'secondary',
    alert: 'destructive',
    link_changed: 'outline',
    calibrated: 'default',
    stale: 'outline',
    disconnected: 'outline',
    reconnected: 'secondary',
  };

function downloadCsv(events: readonly WifiEvent[]) {
  const blob = new Blob([eventsToCsv(events)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wifi-sense-events-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(DISPLAY_DECIMALS);
}

interface EventLogProps {
  events: readonly WifiEvent[];
  onClear: () => void;
}

export function EventLog({ events, onClear }: EventLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Event log</CardTitle>
        <CardDescription>
          Newest first, last {EVENT_LOG_LIMIT}. Kept in this tab only.
        </CardDescription>
        <CardAction className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => downloadCsv(events)}
            disabled={events.length === 0}
          >
            <Download /> Download CSV
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={onClear}
            disabled={events.length === 0}
            aria-label='Clear log'
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            title='No events yet'
            description='Calibrate, then walk across the link.'
          />
        ) : (
          <div className='max-h-96 overflow-y-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className='text-right'>Score</TableHead>
                  <TableHead className='text-right'>T</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className='font-mono'>
                      {new Date(e.t).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={BADGE[e.type]}>{e.type}</Badge>
                    </TableCell>
                    <TableCell className='text-right font-mono'>{fmt(e.score)}</TableCell>
                    <TableCell className='text-right font-mono'>
                      {fmt(e.threshold)}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {e.detail ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
