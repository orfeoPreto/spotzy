import dynamic from 'next/dynamic';

const DisputeDetailClient = dynamic(() => import('./DisputeDetailClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function Page() {
  return <DisputeDetailClient />;
}
