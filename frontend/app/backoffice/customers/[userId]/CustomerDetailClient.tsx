'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AdminGuard } from '../../../../components/AdminGuard';
import { useAuth } from '../../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface CustomerDetail {
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  photoUrl?: string | null;
  personas: string[];
  rating: number;
  status: string;
  listings: { active: any[]; history?: any[] };
  bookings: { active: any[]; history?: any[] };
  disputes: any[];
}

function CustomerDetailContent() {
  const pathname = usePathname();
  const userId = pathname.split('/').filter(Boolean)[2] ?? '';
  const { user } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspending, setSuspending] = useState(false);
  const [suspended, setSuspended] = useState(false);

  const fetchCustomer = useCallback(
    (includeHistory = false) => {
      if (!user || !userId) return;
      const params = includeHistory ? '?includeHistory=true' : '';
      fetch(`${API_URL}/api/v1/admin/customers/${userId}${params}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          setCustomer(d as CustomerDetail);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    },
    [user?.userId, userId],
  );

  useEffect(() => {
    fetchCustomer(showHistory);
  }, [fetchCustomer, showHistory]);

  const handleSuspend = async () => {
    if (!suspendReason.trim() || !user) return;
    setSuspending(true);
    try {
      await fetch(`${API_URL}/api/v1/admin/customers/${userId}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ reason: suspendReason }),
      });
      setSuspended(true);
      setShowSuspendModal(false);
      if (customer) setCustomer({ ...customer, status: 'SUSPENDED' });
    } finally {
      setSuspending(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse h-64 rounded-xl bg-gray-200" />;
  }

  if (!customer) {
    return <p className="text-sm text-gray-500">Customer not found.</p>;
  }

  return (
    <div className="max-w-4xl">
      {/* Identity header */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-[#004526] flex items-center justify-center flex-shrink-0">
            {customer.photoUrl ? (
              <img
                src={customer.photoUrl}
                alt={customer.displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <span className="text-white text-xl font-bold">
                {(customer.firstName || customer.displayName || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1">
            <h1
              data-testid="customer-full-name"
              className="text-xl font-bold text-[#004526]"
            >
              {customer.firstName} {customer.lastName}
            </h1>
            <p className="text-sm text-[#4B6354]">{customer.email}</p>
            {customer.phone && (
              <p className="text-sm text-[#4B6354]">{customer.phone}</p>
            )}
            <div className="flex gap-2 mt-2">
              {customer.personas.map((p) => (
                <span
                  key={p}
                  className="text-xs px-2 py-0.5 rounded-full bg-[#004526]/10 text-[#004526] font-medium"
                >
                  {p}
                </span>
              ))}
              {customer.status === 'SUSPENDED' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                  SUSPENDED
                </span>
              )}
            </div>
          </div>
          {customer.status !== 'SUSPENDED' && (
            <button
              data-testid="suspend-btn"
              onClick={() => setShowSuspendModal(true)}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Suspend
            </button>
          )}
        </div>
      </div>

      {/* Active listings */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-[#004526] mb-3">Active Listings</h2>
        <div data-testid="listings-active" className="space-y-2">
          {customer.listings.active.length === 0 ? (
            <p className="text-sm text-gray-400">No active listings.</p>
          ) : (
            customer.listings.active.map((l: any) => (
              <div key={l.listingId} className="bg-white rounded-lg p-3 shadow-sm flex justify-between items-center">
                <div>
                  <Link
                    href={`/listing/${l.listingId}`}
                    className="text-sm font-medium text-[#006B3C] hover:underline"
                  >
                    {l.address || l.listingId}
                  </Link>
                  {l.pricePerHour != null && (
                    <p className="text-xs text-gray-500 mt-0.5">€{Number(l.pricePerHour).toFixed(2)}/hr</p>
                  )}
                </div>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-[#EBF7F1] text-[#006B3C]">{l.status}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Active bookings */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-[#004526] mb-3">Active Bookings</h2>
        <div data-testid="bookings-active" className="space-y-2">
          {customer.bookings.active.length === 0 ? (
            <p className="text-sm text-gray-400">No active bookings.</p>
          ) : (
            customer.bookings.active.map((b: any) => (
              <div key={b.bookingId} className="bg-white rounded-lg p-3 shadow-sm">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-[#004526]">{b.listingAddress || b.bookingId}</span>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-[#EBF7F1] text-[#006B3C]">{b.status}</span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  {b.startTime && <span>{new Date(b.startTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}</span>}
                  {b.endTime && <span>→ {new Date(b.endTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}</span>}
                  {b.totalPrice != null && <span>€{Number(b.totalPrice).toFixed(2)}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Disputes */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-[#004526] mb-3">Disputes</h2>
        <div data-testid="disputes" className="space-y-2">
          {customer.disputes.length === 0 ? (
            <p className="text-sm text-gray-400">No disputes.</p>
          ) : (
            customer.disputes.map((d: any) => (
              <div key={d.disputeId} className="bg-white rounded-lg p-3 shadow-sm">
                <div className="flex justify-between items-center">
                  <Link
                    href={`/backoffice/disputes/${d.disputeId}`}
                    className="text-sm font-medium text-[#006B3C] hover:underline"
                  >
                    {d.reason || d.disputeId}
                  </Link>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                    d.status === 'ESCALATED' ? 'bg-red-50 text-[#AD3614]' : d.status === 'RESOLVED' ? 'bg-[#EBF7F1] text-[#006B3C]' : 'bg-gray-100 text-gray-600'
                  }`}>{d.status}</span>
                </div>
                {d.createdAt && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Opened {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' })}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Show history toggle */}
      <button
        data-testid="show-history-toggle"
        onClick={() => setShowHistory((h) => !h)}
        className="text-sm font-medium text-[#006B3C] hover:underline mb-6"
      >
        {showHistory ? 'Hide history' : 'Show history'}
      </button>

      {showHistory && customer.listings.history && (
        <section className="mb-6" data-testid="listings-history">
          <h2 className="text-lg font-semibold text-[#004526] mb-3">Listing History</h2>
          <div className="space-y-2">
            {customer.listings.history.map((l: any) => (
              <div key={l.listingId} className="bg-white rounded-lg p-3 shadow-sm">
                <span className="text-sm text-gray-600">{l.address}</span>
                <span className="ml-2 text-xs text-gray-400">{l.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {showHistory && customer.bookings.history && (
        <section className="mb-6" data-testid="bookings-history">
          <h2 className="text-lg font-semibold text-[#004526] mb-3">Booking History</h2>
          <div className="space-y-2">
            {customer.bookings.history.map((b: any) => (
              <div key={b.bookingId} className="bg-white rounded-lg p-3 shadow-sm">
                <span className="text-sm text-gray-600">{b.reference}</span>
                <span className="ml-2 text-xs text-gray-400">{b.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Suspend modal */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div role="dialog" className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-[#004526] mb-4">Suspend Customer</h2>
            <p className="text-sm text-gray-600 mb-3">
              This will disable the user&apos;s login and mark their account as suspended.
            </p>
            <label htmlFor="suspend-reason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason
            </label>
            <textarea
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              rows={3}
              placeholder="Enter reason for suspension..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3C] mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowSuspendModal(false);
                  setSuspendReason('');
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSuspend}
                disabled={suspending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {suspending ? 'Suspending...' : 'Confirm suspend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BackofficeCustomerPage() {
  return (
    <AdminGuard>
      <CustomerDetailContent />
    </AdminGuard>
  );
}
