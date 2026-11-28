'use client';

import { ChevronDown } from 'lucide-react';

import type {
  CalibrationResult,
  SonarCounters,
  SonarDebugSnapshot,
  SonarLogEntry,
  SonarLogKind,
  ToneId,
} from '@/lib/types';
import { TONE_IDS } from '@/lib/sonar/constants';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui';
import { Text } from '@/components/Text';

interface SonarDebugProps {
  debug: SonarDebugSnapshot | null;
  calibration: CalibrationResult | null;
  counters: SonarCounters;
  log: SonarLogEntry[];
}

const LOG_KIND_VARIANT: Record<
  SonarLogKind,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  trigger: 'default',
  ambiguous: 'secondary',
  noise: 'destructive',
  suppressed: 'destructive',
  burst: 'outline',
  calibration: 'secondary',
  info: 'outline',
};

function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatClock(at: number): string {
  const d = new Date(at);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3
  )}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between gap-4 border-b border-border/50 py-1'>
      <Text as='span' variant='muted' size='xs'>
        {label}
      </Text>
      <Text as='span' size='xs' className='text-right font-mono tabular-nums break-all'>
        {value}
      </Text>
    </div>
  );
}

function ToneColumn({
  id,
  debug,
  calibration,
}: {
  id: ToneId;
  debug: SonarDebugSnapshot | null;
  calibration: CalibrationResult | null;
}) {
  const tone = debug?.tones[id];
  const base = calibration?.baseline.tones[id];
  return (
    <div className='flex flex-col'>
      <Text variant='label' size='sm' className='mb-1'>
        Tone {id}
        {tone?.moving && (
          <Badge variant='destructive' className='ml-2'>
            moving
          </Badge>
        )}
      </Text>
      <Row label='frequency' value={`${fmt(tone?.toneHz, 0)} Hz`} />
      <Row label='SNR' value={`${fmt(tone?.snrDb ?? calibration?.snrDb[id])} dB`} />
      <Row label='peak' value={`${fmt(tone?.peakHz, 0)} Hz · ${fmt(tone?.peakDb)} dB`} />
      <Row
        label='leftBins / rightBins'
        value={`${tone?.leftBins ?? '—'} / ${tone?.rightBins ?? '—'}`}
      />
      <Row
        label='baseline L / R'
        value={`${fmt(base?.leftMean)}±${fmt(base?.leftStd)} / ${fmt(base?.rightMean)}±${fmt(
          base?.rightStd
        )}`}
      />
      <Row label='dL / dR' value={`${fmt(tone?.dL)} / ${fmt(tone?.dR)}`} />
      <Row label='zE (proximity)' value={fmt(tone?.zE)} />
      <Row label='velocity' value={`${fmt(tone?.velocity, 2)} m/s`} />
    </div>
  );
}

/** Live numbers and the event log, for tuning on real hardware. */
export function SonarDebug({ debug, calibration, counters, log }: SonarDebugProps) {
  const track = debug ? Object.entries(debug.track) : [];

  return (
    <Collapsible>
      <Card>
        <CardContent className='flex flex-col gap-4'>
          <CollapsibleTrigger
            render={
              <Button variant='ghost' className='group -ml-2 w-fit justify-start' />
            }
          >
            <ChevronDown className='transition-transform group-data-panel-open:rotate-180' />
            <Text variant='hd-xs' as='span'>
              Debug
            </Text>
          </CollapsibleTrigger>
          <CollapsibleContent className='flex flex-col gap-6'>
            <div className='grid gap-6 md:grid-cols-3'>
              <div className='flex flex-col'>
                <Text variant='label' size='sm' className='mb-1'>
                  Audio
                </Text>
                <Row label='sample rate' value={`${fmt(debug?.sampleRate, 0)} Hz`} />
                <Row label='bin width' value={`${fmt(debug?.binWidth, 2)} Hz`} />
                <Row label='fftSize' value={fmt(debug?.fftSize, 0)} />
                <Row label='frame rate' value={`${fmt(debug?.fps, 0)} fps`} />
                <Row label='guard z-score' value={fmt(debug?.guardZ)} />
                <Row label='calibration' value={debug?.calibrationPhase ?? '—'} />
                <Row
                  label='counts L / R'
                  value={`${counters.left} / ${counters.right}`}
                />
                <Row
                  label='ambiguous / suppressed / noise'
                  value={`${counters.ambiguous} / ${counters.suppressed} / ${counters.noise}`}
                />
                <Text variant='label' size='sm' className='mt-3 mb-1'>
                  Mic track settings
                </Text>
                {track.length === 0 ? (
                  <Text variant='muted' size='xs'>
                    Start the sonar to read them.
                  </Text>
                ) : (
                  track.map(([key, value]) => <Row key={key} label={key} value={value} />)
                )}
              </div>
              {TONE_IDS.map((id) => (
                <ToneColumn key={id} id={id} debug={debug} calibration={calibration} />
              ))}
            </div>
            {calibration && calibration.sweep.length > 0 && (
              <div className='flex flex-col gap-1'>
                <Text variant='label' size='sm'>
                  Last sweep (peak SNR per candidate)
                </Text>
                <div className='flex flex-wrap gap-1'>
                  {calibration.sweep.map((c) => (
                    <Badge
                      key={c.hz}
                      variant={
                        c.hz === calibration.toneLHz || c.hz === calibration.toneRHz
                          ? 'default'
                          : 'outline'
                      }
                      className='font-mono'
                    >
                      {c.hz} · {fmt(c.snrDb, 0)} dB
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className='flex flex-col gap-1'>
              <Text variant='label' size='sm'>
                Event log
              </Text>
              <div
                className='flex max-h-64 flex-col gap-1 overflow-y-auto border
                  border-border p-2'
                aria-live='polite'
              >
                {log.length === 0 ? (
                  <Text variant='muted' size='xs'>
                    Nothing yet.
                  </Text>
                ) : (
                  log.map((entry) => (
                    <div key={entry.id} className='flex items-start gap-2'>
                      <Text
                        as='span'
                        variant='muted'
                        size='xs'
                        className='shrink-0 font-mono tabular-nums'
                      >
                        {formatClock(entry.at)}
                      </Text>
                      <Badge variant={LOG_KIND_VARIANT[entry.kind]} className='shrink-0'>
                        {entry.kind}
                      </Badge>
                      <Text as='span' size='xs'>
                        {entry.message}
                      </Text>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
