import dynamic from 'next/dynamic';

const AvailabilityClient = dynamic(() => import('./AvailabilityClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function Page() {
  return <AvailabilityClient />;
}
