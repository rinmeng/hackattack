import { Bell, BellOff, Volume2 } from 'lucide-react';
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
  Switch,
} from '@/components/ui';
import type { WifiNotificationPermission } from '@/hooks/use-wifi-sense';
import type { WifiQuietHours } from '@/lib/types';

const PERMISSION_LABELS: Record<WifiNotificationPermission, string> = {
  default: 'Notifications not enabled',
  granted: 'Notifications on',
  denied: 'Notifications blocked in browser settings',
  unsupported: 'Notifications not supported here',
};

interface QuietHoursProps {
  quietHours: WifiQuietHours;
  onChange: (patch: Partial<WifiQuietHours>) => void;
  inQuietHours: boolean;
  permission: WifiNotificationPermission;
  onEnableAlerts: () => void;
  onTestBeep: () => void;
}

export function QuietHours({
  quietHours,
  onChange,
  inQuietHours,
  permission,
  onEnableAlerts,
  onTestBeep,
}: QuietHoursProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quiet hours</CardTitle>
        <CardDescription>
          Motion during these hours raises an alert: a toast, a notification and a beep,
          at most once a minute.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <label className='flex items-center justify-between gap-2'>
          <Text variant='label' size='sm'>
            Alerts during quiet hours
          </Text>
          <Switch
            checked={quietHours.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
        </label>
        <div className='grid grid-cols-2 gap-3'>
          <label className='flex flex-col gap-1'>
            <Text as='span' variant='muted' size='xs'>
              From
            </Text>
            <Input
              type='time'
              value={quietHours.start}
              onChange={(e) => e.target.value && onChange({ start: e.target.value })}
            />
          </label>
          <label className='flex flex-col gap-1'>
            <Text as='span' variant='muted' size='xs'>
              To
            </Text>
            <Input
              type='time'
              value={quietHours.end}
              onChange={(e) => e.target.value && onChange({ end: e.target.value })}
            />
          </label>
        </div>
        <Text variant='muted' size='xs'>
          Local time. A range like 23:00 to 06:00 runs past midnight.
        </Text>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant={inQuietHours ? 'default' : 'outline'}>
            {inQuietHours ? 'In quiet hours now' : 'Outside quiet hours'}
          </Badge>
          <Badge variant='outline'>{PERMISSION_LABELS[permission]}</Badge>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            onClick={onEnableAlerts}
            disabled={permission === 'granted' || permission === 'unsupported'}
          >
            {permission === 'granted' ? <Bell /> : <BellOff />}
            Enable notifications
          </Button>
          <Button variant='ghost' onClick={onTestBeep}>
            <Volume2 /> Test beep
          </Button>
        </div>
        <Text variant='muted' size='xs'>
          Keep this tab open. Browsers only play sound after you&apos;ve clicked on the
          page, so click either button once.
        </Text>
      </CardContent>
    </Card>
  );
}
