import dynamic from 'next/dynamic';

const CustomerDetailClient = dynamic(() => import('./CustomerDetailClient'), { ssr: false });

export function generateStaticParams() {
  return [{ userId: '_' }];
}

export default function Page() {
  return <CustomerDetailClient />;
}
