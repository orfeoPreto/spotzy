import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./BlockRequestDetailPageClient'), { ssr: false });

export function generateStaticParams() { return [{ reqId: '_' }]; }

export default function Page() {
  return <Client />;
}
