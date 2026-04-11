import PoolDashboardClient from './PoolDashboardClient';

export function generateStaticParams() { return [{ poolId: '_' }]; }

export default function PoolDashboardPage() {
  return <PoolDashboardClient />;
}
