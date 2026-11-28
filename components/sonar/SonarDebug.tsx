'use client';

import { ChevronDown } from 'lucide-react';

import type {
  CalibrationResult,
  SonarCounters,
  SonarDebugSnapshot,
  SonarLogEntry,
  SonarSettings,
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

import { SonarCopyBlock } from './SonarCopyBlock';

interface SonarDebugProps {
  debug: SonarDebugSnapshot | null;
  calibration: CalibrationResult | null;
  counters: SonarCounters;
  log: SonarLogEntry[];
  settings: SonarSettings;
}

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

/** Log as plain text, oldest first, one entry per line. */
function formatLog(log: SonarLogEntry[]): string {
  return log
    .slice()
    .reverse()
    .map((entry) => `${formatClock(entry.at)}  ${entry.kind.padEnd(11)} ${entry.message}`)
    .join('\n');
}

/** Everything needed to tune remotely, as plain text. */
function formatDiagnostics(
  debug: SonarDebugSnapshot | null,
  calibration: CalibrationResult | null,
  counters: SonarCounters,
  settings: SonarSettings
): string {
  if (!debug && !calibration) return '';
  const lines: string[] = [];
  lines.push(
    `settings: ${Object.entries(settings)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')}`
  );
  if (debug) {
    lines.push(
      `audio: sampleRate=${debug.sampleRate} binWidth=${fmt(debug.binWidth, 2)} fftSize=${
        debug.fftSize
      } fps=${fmt(debug.fps, 0)} guardZ=${fmt(debug.guardZ)} calibration=${
        debug.calibrationPhase
      }`
    );
    lines.push(
      `mic: ${Object.entries(debug.track)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`
    );
  }
  lines.push(
    `counts: left=${counters.left} right=${counters.right} ambiguous=${counters.ambiguous} suppressed=${counters.suppressed} noise=${counters.noise}`
  );
  for (const id of TONE_IDS) {
    const base = calibration?.baseline.tones[id];
    if (base) {
      lines.push(
        `baseline ${id}: left=${fmt(base.leftMean, 2)}±${fmt(base.leftStd, 2)} right=${fmt(
          base.rightMean,
          2
        )}±${fmt(base.rightStd, 2)} energy=${fmt(base.energyMean, 4)}±${fmt(
          base.energyStd,
          4
        )} snr=${fmt(calibration?.snrDb[id])}dB`
      );
    }
    const tone = debug?.tones[id];
    if (tone) {
      lines.push(
        `live ${id}: hz=${fmt(tone.toneHz, 0)} peak=${fmt(tone.peakHz, 0)}Hz/${fmt(
          tone.peakDb
        )}dB bins=${tone.leftBins}/${tone.rightBins} dL=${fmt(tone.dL)} dR=${fmt(
          tone.dR
        )} zE=${fmt(tone.zE)} v=${fmt(tone.velocity, 2)}m/s moving=${tone.moving}`
      );
    }
  }
  if (calibration && calibration.sweep.length > 0) {
    lines.push(
      `sweep: ${calibration.sweep.map((c) => `${c.hz}:${fmt(c.snrDb, 0)}`).join(' ')}`
    );
  }
  if (calibration?.warning) lines.push(`warning: ${calibration.warning}`);
  return lines.join('\n');
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
export function SonarDebug({
  debug,
  calibration,
  counters,
  log,
  settings,
}: SonarDebugProps) {
  const track = debug ? Object.entries(debug.track) : [];
  const diagnostics = formatDiagnostics(debug, calibration, counters, settings);
  const logText = formatLog(log);

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
            <SonarCopyBlock
              title='Diagnostics (settings, calibration, live numbers)'
              value={diagnostics}
              emptyText='Start the sonar to collect diagnostics.'
            />
            <SonarCopyBlock
              title={`Event log (${log.length}, oldest first)`}
              value={logText}
              emptyText='Nothing yet.'
            />
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
