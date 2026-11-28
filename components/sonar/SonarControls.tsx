import { Crosshair, Play, Square } from 'lucide-react';

import type { SonarStatus } from '@/lib/types';
import { Badge, Button, Progress } from '@/components/ui';
import { Text } from '@/components/Text';

const STATUS_LABELS: Record<SonarStatus, string> = {
  idle: 'Idle',
  starting: 'Starting',
  calibrating: 'Calibrating',
  'keep-still': 'Keep still…',
  listening: 'Listening',
  noise: 'Noise',
  'too-much-motion': 'Too much motion',
  cooldown: 'Cooldown',
  paused: 'Paused',
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const STATUS_VARIANTS: Record<SonarStatus, BadgeVariant> = {
  idle: 'outline',
  starting: 'secondary',
  calibrating: 'secondary',
  'keep-still': 'secondary',
  listening: 'default',
  noise: 'destructive',
  'too-much-motion': 'destructive',
  cooldown: 'secondary',
  paused: 'outline',
};

interface SonarControlsProps {
  status: SonarStatus;
  running: boolean;
  /** 0 to 1 while calibrating, otherwise null. */
  calibrationProgress: number | null;
  onStart: () => void;
  onStop: () => void;
  onCalibrate: () => void;
}

export function SonarControls({
  status,
  running,
  calibrationProgress,
  onStart,
  onStop,
  onCalibrate,
}: SonarControlsProps) {
  const starting = status === 'starting';
  const calibrating = calibrationProgress !== null;

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {running ? (
          <Button variant='destructive' onClick={onStop}>
            <Square /> Stop
          </Button>
        ) : (
          <Button onClick={onStart} disabled={starting}>
            <Play /> {starting ? 'Starting…' : 'Start'}
          </Button>
        )}
        <Button
          variant='outline'
          onClick={onCalibrate}
          disabled={!running || calibrating || status === 'paused'}
        >
          <Crosshair /> Calibrate
        </Button>
        <div className='ml-auto flex items-center gap-2'>
          <Text variant='muted' size='sm' as='span'>
            Status
          </Text>
          <Badge variant={STATUS_VARIANTS[status]} aria-live='polite'>
            {STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>
      {calibrating && (
        <div className='flex flex-col gap-1'>
          <Text variant='muted' size='xs'>
            {status === 'keep-still'
              ? 'Keep still and quiet: measuring the echo at rest…'
              : 'Sweeping 17–21 kHz to find the clearest tones…'}
          </Text>
          <Progress
            value={Math.round(calibrationProgress * 100)}
            aria-label='Calibration progress'
          />
        </div>
      )}
    </div>
  );
}
