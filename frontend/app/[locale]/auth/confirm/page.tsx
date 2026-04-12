import dynamic from 'next/dynamic';

const ConfirmClient = dynamic(() => import('./ConfirmClient'), { ssr: false });

export function generateStaticParams() { return [{}]; }

export default function ConfirmPage() {
  return <ConfirmClient />;
}
