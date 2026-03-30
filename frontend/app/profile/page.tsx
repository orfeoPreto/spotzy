'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface UserProfile {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  listingCount?: number;
  bookingCount?: number;
}

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [vatNumber, setVatNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [invoicingSaved, setInvoicingSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const token = await getAuthToken();
      if (!token) { router.push('/auth/login'); return; }
      try {
        const [profileRes, metricsRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/users/me`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/api/v1/users/me/metrics`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const profile = await profileRes.json();
        const metrics = await metricsRes.json() as { liveListings?: number; activeBookings?: number };
        setUser({ ...profile, listingCount: metrics.liveListings ?? 0, bookingCount: metrics.activeBookings ?? 0 });
        setIsHost(profile.isHost === true || profile.role === 'HOST' || profile.role === 'both');
        setNameValue(profile.name ?? '');
        setEmailValue(profile.email ?? '');
        setPhoneValue(profile.phone ?? '');
        // Load invoicing details
        try {
          const invoicingRes = await fetch(`${API_URL}/api/v1/users/me/invoicing`, { headers: { Authorization: `Bearer ${token}` } });
          if (invoicingRes.ok) {
            const inv = await invoicingRes.json() as Record<string, string>;
            setVatNumber(inv.vatNumber ?? '');
            setCompanyName(inv.companyName ?? '');
            const addrParts = [inv.billingStreet, inv.billingCity, inv.billingPostcode].filter(Boolean);
            setBillingAddress(addrParts.join(', '));
          }
        } catch {
          // non-blocking
        }
      } catch {
        // ignore — show empty state
      }
    };
    load();
  }, [router]);

  const handleSaveName = async () => {
    if (!nameValue.trim() || !user) return;
    setSaving(true);
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      setUser((u) => u ? { ...u, name: nameValue.trim() } : u);
      setEditingName(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!emailValue.trim() || !user) return;
    setSaving(true);
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue.trim() }),
      });
      setUser((u) => u ? { ...u, email: emailValue.trim() } : u);
      setEditingEmail(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePhone = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneValue.trim() }),
      });
      setUser((u) => u ? { ...u, phone: phoneValue.trim() } : u);
      setEditingPhone(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInvoicing = async () => {
    setSaving(true);
    setInvoicingSaved(false);
    try {
      const token = await getAuthToken();
      // Parse billing address into parts (street, city, postcode)
      const parts = billingAddress.split(',').map((p) => p.trim());
      await fetch(`${API_URL}/api/v1/users/me/invoicing`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vatNumber: vatNumber.trim() || null,
          companyName: companyName.trim() || null,
          billingStreet: parts[0] || null,
          billingCity: parts[1] || null,
          billingPostcode: parts[2] || null,
        }),
      });
      setInvoicingSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { signOut } = await import('aws-amplify/auth');
      await signOut();
    } catch {
      // ignore
    }
    router.push('/auth/login');
  };

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">Loading profile…</p>
      </main>
    );
  }

  const hasListings = (user.listingCount ?? 0) > 0;

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      {/* Profile header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#004526] text-2xl font-bold text-white">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="name"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={saving}
                className="btn-gold rounded-lg px-3 py-1 text-xs"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="text-xs text-gray-400">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#004526]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                {user.name}
              </h1>
              <button
                type="button"
                data-testid="edit-name"
                onClick={() => setEditingName(true)}
                aria-label="Edit name"
                className="text-gray-400 hover:text-[#004526]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
            </div>
          )}

          {/* Role badges */}
          <div className="mt-1 flex gap-2">
            {hasListings && (
              <span
                data-testid="host-badge"
                className="rounded-full bg-[#004526] px-2 py-0.5 text-xs font-medium text-white"
              >
                Host
              </span>
            )}
            <span
              data-testid="spotter-badge"
              className="rounded-full bg-[#006B3C] px-2 py-0.5 text-xs font-medium text-white"
            >
              Spotter
            </span>
          </div>
        </div>
      </div>

      {/* Contact info */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#004526]">Contact info</h3>

        {/* Email */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
          {editingEmail ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="email"
                type="email"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveEmail}
                disabled={saving}
                className="btn-gold rounded-lg px-3 py-1 text-xs"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingEmail(false)} className="text-xs text-gray-400">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-900">{user.email || 'Not set'}</p>
              <button
                type="button"
                data-testid="edit-email"
                onClick={() => setEditingEmail(true)}
                aria-label="Edit email"
                className="text-gray-400 hover:text-[#004526]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone</label>
          {editingPhone ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="phone"
                type="tel"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSavePhone}
                disabled={saving}
                className="btn-gold rounded-lg px-3 py-1 text-xs"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingPhone(false)} className="text-xs text-gray-400">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-900">{user.phone || 'Not set'}</p>
              <button
                type="button"
                data-testid="edit-phone"
                onClick={() => setEditingPhone(true)}
                aria-label="Edit phone"
                className="text-gray-400 hover:text-[#004526]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div data-testid="spots-summary" className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">My spots</p>
          <p className="text-lg font-bold text-[#004526]">{user.listingCount ?? 0} live listing{(user.listingCount ?? 0) !== 1 ? 's' : ''}</p>
          <Link href="/dashboard/host" className="mt-1 block text-xs text-[#006B3C] hover:underline">
            View listings →
          </Link>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">My bookings</p>
          <p className="text-lg font-bold text-[#004526]">{user.bookingCount ?? 0} active</p>
          <Link href="/dashboard/spotter" className="mt-1 block text-xs text-[#006B3C] hover:underline">
            View bookings →
          </Link>
        </div>
      </div>

      {/* Payment info */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[#004526]">Payment info</p>
            <p className="text-xs text-gray-500">Manage via Stripe</p>
          </div>
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#006B3C] hover:underline"
          >
            Open →
          </a>
        </div>
      </div>

      {/* Invoicing details — only shown for hosts */}
      {isHost && <div data-testid="invoicing-section" className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-[#004526]">Invoicing details</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="vatNumber" className="mb-1 block text-xs font-medium text-gray-600">VAT number</label>
            <input id="vatNumber" type="text" placeholder="BE0123456789" value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" />
          </div>
          <div>
            <label htmlFor="companyName" className="mb-1 block text-xs font-medium text-gray-600">Company name</label>
            <input id="companyName" type="text" placeholder="Company name" value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" />
          </div>
          <div>
            <label htmlFor="billingAddress" className="mb-1 block text-xs font-medium text-gray-600">Billing address</label>
            <input id="billingAddress" type="text" placeholder="Street, City, Postcode" value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" />
          </div>
          <button type="button"
            onClick={() => void handleSaveInvoicing()}
            disabled={saving}
            className="w-full rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40">
            {saving ? 'Saving...' : 'Save invoicing details'}
          </button>
          {invoicingSaved && <p className="text-center text-xs text-green-600">Invoicing details saved</p>}
        </div>
      </div>}

      {/* Sign out */}
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full rounded-xl border border-red-200 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Log out
      </button>
    </main>
  );
}
