import dynamic from 'next/dynamic';

const PublicProfileClient = dynamic(() => import('./PublicProfileClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function PublicProfilePage() {
  return <PublicProfileClient />;
}
