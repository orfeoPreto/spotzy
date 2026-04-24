import dynamic from 'next/dynamic';

const HostLandingClient = dynamic(
  () => import('../../components/landing-host/HostLandingClient'),
  { ssr: false },
);

export function generateStaticParams() { return [{}]; }

export default function Page() {
  return <HostLandingClient />;
}
