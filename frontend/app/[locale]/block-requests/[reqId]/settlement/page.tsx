import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./SettlementPageClient'), { ssr: false });

export function generateStaticParams() { return [{ reqId: '_' }]; }

export default function Page() {
  return <Client />;
}
