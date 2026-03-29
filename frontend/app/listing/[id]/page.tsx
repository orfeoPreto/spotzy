import dynamic from 'next/dynamic';

const ListingClient = dynamic(() => import('./ListingClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function Page() {
  return <ListingClient />;
}
