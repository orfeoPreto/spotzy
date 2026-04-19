export function generateStaticParams() { return [{}]; }
import dynamic from 'next/dynamic';

const BecomeHostClient = dynamic(() => import('./BecomeHostClient'), { ssr: false });

export default function BecomeHostPage() {
  return <BecomeHostClient />;
}
