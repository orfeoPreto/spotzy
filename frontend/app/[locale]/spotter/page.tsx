import dynamic from 'next/dynamic';

const Client = dynamic(() => import('../page.full'), { ssr: false });

export default function SpotterLandingPage() {
  return <Client />;
}
