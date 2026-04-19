import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./ArchivedDisputesPageClient'), { ssr: false });

export function generateStaticParams() { return [{}]; }

export default function Page() {
  return <Client />;
}
