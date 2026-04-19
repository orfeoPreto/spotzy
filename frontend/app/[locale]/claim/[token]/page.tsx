import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./MagicLinkClaimPageClient'), { ssr: false });

export function generateStaticParams() { return [{ token: '_' }]; }

export default function Page() {
  return <Client />;
}
