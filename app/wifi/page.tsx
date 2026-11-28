import type { Metadata } from 'next';
import { Text } from '@/components/Text';
import { WifiSenseApp } from '@/components/wifi-sense/WifiSenseApp';

export const metadata: Metadata = {
  title: 'Afterlife Wi-Fi Sense',
  description: 'A camera-free motion alarm from an old router and the Wi-Fi signal.',
};

export default function WifiSensePage() {
  return (
    <div className='container nb-padding mx-auto px-4'>
      <div className='mx-auto flex max-w-6xl flex-col gap-8'>
        <div className='flex flex-col gap-2 text-center fade-in-from-top'>
          <Text variant='hd-xl'>Afterlife Wi-Fi Sense</Text>
          <Text variant='muted' size='lg'>
            A camera-free motion alarm: an old router across the room, and this Mac
            watching how its Wi-Fi signal wobbles when someone walks through.
          </Text>
        </div>
        <WifiSenseApp />
      </div>
    </div>
  );
}
