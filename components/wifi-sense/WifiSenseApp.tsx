'use client';

import { CalibrationPanel } from '@/components/wifi-sense/CalibrationPanel';
import { ConnectionPanel } from '@/components/wifi-sense/ConnectionPanel';
import { Diagnostics } from '@/components/wifi-sense/Diagnostics';
import { EventLog } from '@/components/wifi-sense/EventLog';
import { QuietHours } from '@/components/wifi-sense/QuietHours';
import { SettingsPanel } from '@/components/wifi-sense/SettingsPanel';
import { SignalChart } from '@/components/wifi-sense/SignalChart';
import { StatusIndicator } from '@/components/wifi-sense/StatusIndicator';
import { Text } from '@/components/Text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useWifiSense } from '@/hooks/use-wifi-sense';

export function WifiSenseApp() {
  const wifi = useWifiSense();
  const live = wifi.connection === 'open' && wifi.snapshot?.state !== 'DISCONNECTED';

  return (
    <div className='flex flex-col gap-6'>
      <StatusIndicator snapshot={wifi.connection === 'open' ? wifi.snapshot : null} />

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='flex flex-col gap-6 lg:col-span-2'>
          <Card>
            <CardHeader>
              <CardTitle>Signal</CardTitle>
            </CardHeader>
            <CardContent>
              <SignalChart detectorRef={wifi.detectorRef} />
            </CardContent>
          </Card>
          <CalibrationPanel
            snapshot={wifi.snapshot}
            canCalibrate={live}
            onStart={wifi.startCalibration}
            onCancel={wifi.cancelCalibration}
            onReset={wifi.resetCalibration}
          />
          <EventLog events={wifi.events} onClear={wifi.clearEvents} />
        </div>

        <div className='flex flex-col gap-6'>
          <ConnectionPanel
            collectorUrl={wifi.collectorUrl}
            onCollectorUrlChange={wifi.setCollectorUrl}
            connection={wifi.connection}
            status={wifi.collectorStatus}
          />
          <QuietHours
            quietHours={wifi.quietHours}
            onChange={wifi.updateQuietHours}
            inQuietHours={wifi.inQuietHours}
            permission={wifi.notificationPermission}
            onEnableAlerts={() => void wifi.enableAlerts()}
            onTestBeep={wifi.testAlert}
          />
          <SettingsPanel
            settings={wifi.settings}
            onChange={wifi.updateSettings}
            onReset={wifi.resetSettings}
          />
          <Diagnostics
            health={wifi.health}
            snapshot={wifi.snapshot}
            onMockScene={wifi.setMockScene}
          />
        </div>
      </div>

      <Text variant='muted' size='sm' className='text-center'>
        What this can&apos;t do: see someone sitting perfectly still, count people, or
        tell whether someone came in or went out. It only notices movement that disturbs
        the link between this Mac and the access point.
      </Text>
    </div>
  );
}
