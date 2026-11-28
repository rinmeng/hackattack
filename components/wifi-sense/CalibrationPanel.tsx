import { Footprints, TriangleAlert, Users } from 'lucide-react';
import { Text } from '@/components/Text';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from '@/components/ui';
import type { WifiCalibrationStep, WifiDetectorSnapshot } from '@/lib/types';
import {
  DISPLAY_DECIMALS,
  EMPTY_CALIBRATION_MS,
  MS_PER_SECOND,
  OUTSIDE_CALIBRATION_MS,
  PERCENT,
} from '@/lib/wifi-sense/constants';

const STEPS: {
  step: WifiCalibrationStep;
  title: string;
  instruction: string;
  durationMs: number;
  icon: typeof Users;
}[] = [
  {
    step: 'empty',
    title: '1. Empty room',
    instruction:
      'Everyone leave the room. Keep doors, the laptop and the router where they will stay.',
    durationMs: EMPTY_CALIBRATION_MS,
    icon: Users,
  },
  {
    step: 'outside',
    title: '2. Outside motion',
    instruction:
      'Walk around just outside the room (hallway or next room), but not inside it.',
    durationMs: OUTSIDE_CALIBRATION_MS,
    icon: Footprints,
  },
];

interface CalibrationPanelProps {
  snapshot: WifiDetectorSnapshot | null;
  canCalibrate: boolean;
  onStart: (step: WifiCalibrationStep, durationMs: number) => void;
  onCancel: () => void;
  onReset: () => void;
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toFixed(DISPLAY_DECIMALS);
}

export function CalibrationPanel({
  snapshot,
  canCalibrate,
  onStart,
  onCancel,
  onReset,
}: CalibrationPanelProps) {
  const calibration = snapshot?.calibration ?? null;
  const running = snapshot?.calibrating ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration</CardTitle>
        <CardDescription>
          Teaches the detector how much the signal wobbles on its own, and how much
          neighbours disturb it.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {STEPS.map(({ step, title, instruction, durationMs, icon: Icon }) => {
          const active = running?.step === step;
          const done =
            step === 'empty' ? calibration !== null : calibration?.p95Outside != null;
          const blocked = step === 'outside' && calibration === null;
          const remainingS = active
            ? Math.ceil((running.durationMs - running.elapsedMs) / MS_PER_SECOND)
            : 0;
          return (
            <div key={step} className='flex flex-col gap-2 border p-3'>
              <div className='flex items-center justify-between gap-2'>
                <span className='flex items-center gap-2'>
                  <Icon className='size-4' aria-hidden />
                  <Text variant='label' size='sm'>
                    {title}
                  </Text>
                  {done && !active && <Badge variant='secondary'>Done</Badge>}
                </span>
                {active ? (
                  <Button size='sm' variant='outline' onClick={onCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size='sm'
                    disabled={!canCalibrate || running !== null || blocked}
                    onClick={() => onStart(step, durationMs)}
                  >
                    {done ? 'Redo' : 'Start'} ({durationMs / MS_PER_SECOND} s)
                  </Button>
                )}
              </div>
              <Text variant='muted' size='sm'>
                {instruction}
              </Text>
              {active && (
                <div className='flex flex-col gap-1'>
                  <Progress value={(running.elapsedMs / running.durationMs) * PERCENT} />
                  <Text size='sm' className='font-mono'>
                    {remainingS} s left
                  </Text>
                </div>
              )}
            </div>
          );
        })}

        {snapshot?.calibrationError && (
          <Alert variant='destructive'>
            <TriangleAlert />
            <AlertTitle>Calibration failed</AlertTitle>
            <AlertDescription>{snapshot.calibrationError}</AlertDescription>
          </Alert>
        )}

        {calibration && calibration.p95Outside === null && !running && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Outside-motion step skipped</AlertTitle>
            <AlertDescription>
              The threshold only knows the empty room, so people next door or in the
              hallway may trigger it. Run step 2 to fix that.
            </AlertDescription>
          </Alert>
        )}

        <dl className='grid grid-cols-4 gap-2 font-mono text-sm'>
          {[
            ['mu', fmt(calibration?.mu)],
            ['sigma', fmt(calibration?.sigma)],
            ['p95 out', fmt(calibration?.p95Outside)],
            ['T', fmt(snapshot?.threshold)],
          ].map(([label, value]) => (
            <div key={label} className='flex flex-col'>
              <dt className='text-xs text-muted-foreground'>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <div className='flex items-center justify-between gap-2'>
          <Text variant='muted' size='xs'>
            {calibration
              ? `Calibrated ${new Date(calibration.calibratedAt).toLocaleString()} (${calibration.scoreType.toUpperCase()}, ${calibration.windowMs / MS_PER_SECOND} s window)`
              : 'Not calibrated yet.'}
          </Text>
          <Button
            size='sm'
            variant='ghost'
            onClick={onReset}
            disabled={!calibration && !running}
          >
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
