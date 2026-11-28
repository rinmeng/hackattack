'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { AlertTriangle, Info } from 'lucide-react';

import type { SonarEnvironmentIssue, SonarErrorInfo } from '@/lib/types';
import { DURATIONS } from '@/lib/durations';
import { ENVIRONMENT_MESSAGES } from '@/lib/sonar/constants';
import { detectEnvironmentIssue } from '@/lib/sonar/environment';
import { Alert, AlertDescription, AlertTitle, Card, CardContent } from '@/components/ui';
import { Text } from '@/components/Text';
import { useSonar } from '@/hooks/use-sonar';
import { useToast } from '@/hooks/use-toast';

import { GestureButtons } from './GestureButtons';
import { SonarControls } from './SonarControls';
import { SonarDebug } from './SonarDebug';
import { SonarSettings } from './SonarSettings';
import { SpectrumCanvas } from './SpectrumCanvas';
import { VelocityTrace } from './VelocityTrace';

/** The environment doesn't change while the page is open, so nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => undefined;
}

function serverEnvironment(): SonarEnvironmentIssue {
  return 'ok';
}

export function SonarApp() {
  const sonar = useSonar();
  const { on, start, stop, calibrate, trigger } = sonar;
  const { toast } = useToast();
  const [error, setError] = useState<SonarErrorInfo | null>(null);
  const environment = useSyncExternalStore(
    subscribeNever,
    detectEnvironmentIssue,
    serverEnvironment
  );

  useEffect(
    () =>
      on('calibrated', (result) => {
        if (result.warning) {
          toast.warning('Calibration warning', {
            description: result.warning,
            duration: DURATIONS.TOAST_LONG,
          });
        } else {
          toast.success(
            `Calibrated: ${Math.round(result.toneLHz)} Hz (L) and ${Math.round(
              result.toneRHz
            )} Hz (R)`
          );
        }
      }),
    [on, toast]
  );

  const handleStart = async () => {
    setError(null);
    const failure = await start();
    if (failure) {
      setError(failure);
      toast.error(failure.title, {
        description: failure.description,
        duration: DURATIONS.TOAST_LONG,
      });
    }
  };

  const environmentMessage =
    environment === 'ok' ? null : ENVIRONMENT_MESSAGES[environment];
  const calibrationWarning = sonar.calibration?.warning ?? null;

  return (
    <div className='flex flex-col gap-6'>
      {environmentMessage && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>{environmentMessage.title}</AlertTitle>
          <AlertDescription>{environmentMessage.description}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant='destructive'>
          <AlertTriangle />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.description}</AlertDescription>
        </Alert>
      )}
      {calibrationWarning && sonar.running && (
        <Alert>
          <Info />
          <AlertTitle>Weak ultrasonic signal</AlertTitle>
          <AlertDescription>{calibrationWarning}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <SonarControls
            status={sonar.status}
            running={sonar.running}
            calibrationProgress={sonar.debug?.calibrationProgress ?? null}
            onStart={handleStart}
            onStop={stop}
            onCalibrate={calibrate}
          />
        </CardContent>
      </Card>

      <GestureButtons
        on={on}
        counts={{ left: sonar.counters.left, right: sonar.counters.right }}
        onPress={trigger}
      />
      <Text variant='muted' size='sm' className='text-center'>
        Wave a hand left or right about 20 cm above the keyboard. The arrow keys fire the
        buttons too, so you can test without sonar.
      </Text>

      <Card>
        <CardContent className='flex flex-col gap-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <SpectrumCanvas tone='L' fallbackHz={sonar.settings.toneLHz} on={on} />
            <SpectrumCanvas tone='R' fallbackHz={sonar.settings.toneRHz} on={on} />
          </div>
          <VelocityTrace on={on} />
          <Text variant='muted' size='xs'>
            Shaded: scanned bandwidth. Dashed red: the bandwidth threshold. Faint line:
            the stillness baseline. A left-to-right wave moves tone L first, then tone R.
          </Text>
        </CardContent>
      </Card>

      <SonarSettings
        settings={sonar.settings}
        onChange={sonar.updateSettings}
        onReset={sonar.resetSettings}
      />
      <SonarDebug
        debug={sonar.debug}
        calibration={sonar.calibration}
        counters={sonar.counters}
        log={sonar.log}
        settings={sonar.settings}
      />
    </div>
  );
}
