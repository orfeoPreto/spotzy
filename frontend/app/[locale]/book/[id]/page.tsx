import dynamic from 'next/dynamic';

const BookClient = dynamic(() => import('./BookClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function Page() {
  return <BookClient />;
}
