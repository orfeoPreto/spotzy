import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./RegisterPageClient'), { ssr: false });

export function generateStaticParams() { return [{}]; }

export default function Page() {
  return <Client />;
}
