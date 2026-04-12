import dynamic from 'next/dynamic';

const EditListingClient = dynamic(() => import('./EditListingClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function Page() {
  return <EditListingClient />;
}
