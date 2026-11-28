import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Gauge,
  Hourglass,
  Loader,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { Text } from '@/components/Text';
import type { WifiDetectorSnapshot, WifiDetectorState } from '@/lib/types';
import { DISPLAY_DECIMALS } from '@/lib/wifi-sense/constants';
import { cn } from '@/lib/utils';

interface StateLook {
  label: string;
  hint: string;
  icon: LucideIcon;
  className: string;
}

const LOOKS: Record<WifiDetectorState, StateLook> = {
  CLEAR: {
    label: 'CLEAR',
    hint: 'No movement across the link.',
    icon: ShieldCheck,
    className:
      'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  },
  MOTION: {
    label: 'MOTION',
    hint: 'Something is moving across the link.',
    icon: Activity,
    className: 'border-red-600 bg-red-600/15 text-red-700 dark:text-red-400',
  },
  STALE: {
    label: 'STALE',
    hint: 'No fresh readings. The room may not be clear.',
    icon: Hourglass,
    className: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  NEEDS_RECALIBRATION: {
    label: 'NEEDS RECALIBRATION',
    hint: 'The link changed, so the old calibration no longer fits.',
    icon: RefreshCw,
    className: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  CALIBRATING: {
    label: 'CALIBRATING',
    hint: 'Measuring the room. Follow the calibration instructions.',
    icon: Loader,
    className: 'border-sky-600 bg-sky-600/10 text-sky-700 dark:text-sky-400',
  },
  UNCALIBRATED: {
    label: 'NOT CALIBRATED',
    hint: 'Run "Empty room" calibration to start detecting.',
    icon: Gauge,
    className: 'border-border bg-muted text-muted-foreground',
  },
  DISCONNECTED: {
    label: 'NO WI-FI LINK',
    hint: 'This Mac is not connected to the access point.',
    icon: WifiOff,
    className: 'border-border bg-muted text-muted-foreground',
  },
};

const RECALIBRATION_HINTS = {
  link_changed: 'The link changed (moved laptop or router, or another network).',
  settings_changed: 'Window or score type changed since calibrating.',
} as const;

interface StatusIndicatorProps {
  snapshot: WifiDetectorSnapshot | null;
}

/** The big status display, readable from across the room. */
export function StatusIndicator({ snapshot }: StatusIndicatorProps) {
  const state = snapshot?.state ?? 'STALE';
  const look = LOOKS[state];
  const Icon = look.icon;
  const hint =
    state === 'NEEDS_RECALIBRATION' && snapshot?.recalibrationReason
      ? RECALIBRATION_HINTS[snapshot.recalibrationReason]
      : look.hint;

  return (
    <div
      role='status'
      aria-live='polite'
      className={cn(
        `flex flex-col items-center gap-4 border-4 px-6 py-10 text-center
        transition-colors`,
        look.className
      )}
    >
      <Icon
        className={cn('size-20 md:size-28', state === 'CALIBRATING' && 'animate-spin')}
        strokeWidth={2.5}
        aria-hidden
      />
      <Text
        as='p'
        variant='label'
        className='text-5xl font-black tracking-tight md:text-7xl lg:text-8xl'
      >
        {look.label}
      </Text>
      <Text size='lg'>{hint}</Text>
      <Text variant='muted' size='sm' className='font-mono'>
        score {snapshot?.score?.toFixed(DISPLAY_DECIMALS) ?? '—'} / T{' '}
        {snapshot?.threshold?.toFixed(DISPLAY_DECIMALS) ?? '—'} dB
      </Text>
    </div>
  );
}
