import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./PoolListingNewPageClient'), { ssr: false });

export function generateStaticParams() { return [{}]; }

export default function Page() {
  return <Client />;
}
