import dynamic from 'next/dynamic';

const DisputeClient = dynamic(() => import('./DisputeClient'), { ssr: false });

export function generateStaticParams() {
  return [{ bookingId: '_' }];
}

export default function Page() {
  return <DisputeClient />;
}
