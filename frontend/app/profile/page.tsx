'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserAvatar } from '../../components/UserAvatar';
import { resolveDisplayName } from '../../lib/resolveDisplayName';
import { DeleteAccountModal } from '../../components/DeleteAccountModal';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const COUNTRY_CODES = [
  { value: '+32', label: '\u{1F1E7}\u{1F1EA} +32' },
  { value: '+33', label: '\u{1F1EB}\u{1F1F7} +33' },
  { value: '+31', label: '\u{1F1F3}\u{1F1F1} +31' },
  { value: '+49', label: '\u{1F1E9}\u{1F1EA} +49' },
  { value: '+44', label: '\u{1F1EC}\u{1F1E7} +44' },
  { value: '+352', label: '\u{1F1F1}\u{1F1FA} +352' },
  { value: '+1', label: '\u{1F1FA}\u{1F1F8} +1' },
];

interface UserProfile {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  pseudo?: string | null;
  profilePhotoUrl?: string | null;
  showFullNamePublicly?: boolean;
  listingCount?: number;
  bookingCount?: number;
  // Session 26 — Spot Manager fields
  spotManagerStatus?: 'NONE' | 'STAGED' | 'ACTIVE';
  blockReservationCapable?: boolean;
  rcInsuranceStatus?: 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'EXPIRED' | 'REJECTED';
  rcInsuranceExpiryDate?: string | null;
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
  const [firstNameValue, setFirstNameValue] = useState('');
  const [lastNameValue, setLastNameValue] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+32');
  const [saving, setSaving] = useState(false);
  const [editingPseudo, setEditingPseudo] = useState(false);
  const [pseudoValue, setPseudoValue] = useState('');
  const [showFullNamePublicly, setShowFullNamePublicly] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [isHost, setIsHost] = useState(false);
  const [vatNumber, setVatNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [invoicingSaved, setInvoicingSaved] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportUrl, setExportUrl] = useState('');
  const [deleteBlockError, setDeleteBlockError] = useState('');

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
        setFirstNameValue(profile.firstName ?? profile.name?.split(' ')[0] ?? '');
        setLastNameValue(profile.lastName ?? profile.name?.split(' ').slice(1).join(' ') ?? '');
        setPseudoValue(profile.pseudo ?? '');
        setShowFullNamePublicly(profile.showFullNamePublicly ?? false);
        setEmailValue(profile.email ?? '');
        const existingPhone = profile.phone ?? '';
        const knownPrefixes = ['+352', '+32', '+33', '+31', '+49', '+44', '+1'];
        const matchedPrefix = knownPrefixes.find((p) => existingPhone.startsWith(p));
        if (matchedPrefix) {
          setPhoneCountryCode(matchedPrefix);
          setPhoneValue(existingPhone.slice(matchedPrefix.length));
        } else {
          setPhoneValue(existingPhone);
        }
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
    if (!firstNameValue.trim() || !user) return;
    setSaving(true);
    const fullName = `${firstNameValue.trim()} ${lastNameValue.trim()}`.trim();
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, firstName: firstNameValue.trim(), lastName: lastNameValue.trim() }),
      });
      setUser((u) => u ? { ...u, name: fullName } : u);
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
      const fullPhone = phoneCountryCode + phoneValue.replace(/^0/, '').trim();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      });
      setUser((u) => u ? { ...u, phone: fullPhone } : u);
      setEditingPhone(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePseudo = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo: pseudoValue.trim() || null }),
      });
      setUser((u) => u ? { ...u, pseudo: pseudoValue.trim() || null } : u);
      setEditingPseudo(false);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFullName = async (checked: boolean) => {
    setShowFullNamePublicly(checked);
    try {
      const token = await getAuthToken();
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ showFullNamePublicly: checked }),
      });
      setUser((u) => u ? { ...u, showFullNamePublicly: checked } : u);
    } catch {
      setShowFullNamePublicly(!checked);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const token = await getAuthToken();
      const urlRes = await fetch(`${API_URL}/api/v1/users/me/photo-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!urlRes.ok) return;
      const { uploadUrl, publicUrl } = await urlRes.json() as { uploadUrl: string; publicUrl: string };
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhotoUrl: publicUrl }),
      });
      setUser((u) => u ? { ...u, profilePhotoUrl: publicUrl } : u);
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
        <div className="cursor-pointer" onClick={() => photoInputRef.current?.click()}>
          <UserAvatar
            user={{ photoUrl: user.profilePhotoUrl, pseudo: user.pseudo, firstName: user.name.split(' ')[0] || user.name }}
            size={80}
          />
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handlePhotoUpload(e)} />
        </div>
        <div className="flex-1">
          {editingName ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  aria-label="first name"
                  value={firstNameValue}
                  onChange={(e) => setFirstNameValue(e.target.value)}
                  placeholder="First name"
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  autoFocus
                />
                <input
                  aria-label="last name"
                  value={lastNameValue}
                  onChange={(e) => setLastNameValue(e.target.value)}
                  placeholder="Last name"
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={saving || !firstNameValue.trim()}
                  className="btn-gold rounded-lg px-3 py-1 text-xs"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditingName(false)} className="text-xs text-gray-400">
                  Cancel
                </button>
              </div>
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
          <div className="mt-1 flex flex-wrap gap-2">
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
            {(user.spotManagerStatus === 'ACTIVE' || user.spotManagerStatus === 'STAGED') && (
              <span
                data-testid="spot-manager-badge"
                className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${user.spotManagerStatus === 'ACTIVE' ? 'bg-gradient-to-r from-[#004526] to-[#006B3C]' : 'bg-amber-600'}`}
                title={user.spotManagerStatus === 'ACTIVE' ? 'Spot Manager — block reservations enabled' : 'Spot Manager (pending RC review)'}
              >
                Spot Manager{user.spotManagerStatus === 'STAGED' ? ' (pending)' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Display name (pseudo) */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#004526]">Display name</h3>
        {editingPseudo ? (
          <div className="flex items-center gap-2">
            <input
              aria-label="display name"
              value={pseudoValue}
              onChange={(e) => setPseudoValue(e.target.value)}
              placeholder="e.g. SpotKing"
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
              autoFocus
            />
            <button type="button" onClick={() => void handleSavePseudo()} disabled={saving}
              className="btn-gold rounded-lg px-3 py-1 text-xs">{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setEditingPseudo(false)} className="text-xs text-gray-400">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-900">
              {resolveDisplayName({ pseudo: user.pseudo, firstName: user.name.split(' ')[0] || user.name })}
            </p>
            {user.pseudo && <span className="text-xs text-gray-400">(display name)</span>}
            <button type="button" data-testid="edit-pseudo" onClick={() => setEditingPseudo(true)} aria-label="Edit display name"
              className="text-gray-400 hover:text-[#004526]">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="showFullName"
            checked={showFullNamePublicly}
            onChange={(e) => void handleToggleFullName(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#006B3C] focus:ring-[#006B3C]"
          />
          <label htmlFor="showFullName" className="text-sm text-gray-600">Show my full name publicly</label>
        </div>
      </div>

      {/* Contact info */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#004526]">Contact info</h3>

        {/* Email (read-only) */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
          <p className="text-sm text-gray-900">{user.email || 'Not set'}</p>
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone</label>
          {editingPhone ? (
            <div className="flex items-center gap-2">
              <select
                value={phoneCountryCode}
                onChange={(e) => setPhoneCountryCode(e.target.value)}
                className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                {COUNTRY_CODES.map((cc) => (
                  <option key={cc.value} value={cc.value}>{cc.label}</option>
                ))}
              </select>
              <input
                aria-label="phone"
                type="tel"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value)}
                placeholder="471234567"
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

      {/* Spot Manager status (Session 26) */}
      {(user.spotManagerStatus === 'ACTIVE' || user.spotManagerStatus === 'STAGED') && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-[#004526]">Spot Manager</p>
            <Link href="/spot-manager/portfolio" className="text-xs text-[#006B3C] hover:underline">
              Open portfolio →
            </Link>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Status:</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                user.spotManagerStatus === 'ACTIVE'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {user.spotManagerStatus === 'ACTIVE' ? 'Active' : 'Staged (pending)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">RC insurance:</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                user.rcInsuranceStatus === 'APPROVED' ? 'bg-green-100 text-green-700' :
                user.rcInsuranceStatus === 'PENDING_REVIEW' ? 'bg-blue-100 text-blue-700' :
                user.rcInsuranceStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                user.rcInsuranceStatus === 'EXPIRED' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {user.rcInsuranceStatus === 'PENDING_REVIEW' ? 'Pending review' :
                 user.rcInsuranceStatus === 'APPROVED' ? 'Approved' :
                 user.rcInsuranceStatus === 'REJECTED' ? 'Rejected' :
                 user.rcInsuranceStatus === 'EXPIRED' ? 'Expired' : 'Not submitted'}
              </span>
            </div>
            {user.rcInsuranceExpiryDate && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-32">Expires on:</span>
                <span className="text-gray-700">{new Date(user.rcInsuranceExpiryDate).toLocaleDateString()}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-32">Block reservations:</span>
              <span className={user.blockReservationCapable ? 'text-green-700' : 'text-gray-500'}>
                {user.blockReservationCapable ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
      )}

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

      {/* Privacy & Data */}
      <div className="rounded-2xl border border-[#C8DDD2] bg-white p-6 space-y-4" data-testid="privacy-section">
        <h2 className="text-sm font-semibold text-[#004526]">Privacy & Data</h2>
        <div className="flex flex-col gap-3">
          <Link href="/privacy" className="text-sm text-[#006B3C] underline" target="_blank">
            View Privacy Policy
          </Link>
          <button
            type="button"
            onClick={async () => {
              setExportLoading(true);
              setExportUrl('');
              try {
                const token = await getAuthToken();
                const res = await fetch(`${API_URL}/api/v1/users/me/export`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const data = await res.json() as { downloadUrl: string };
                  setExportUrl(data.downloadUrl);
                }
              } finally {
                setExportLoading(false);
              }
            }}
            disabled={exportLoading}
            className="w-full rounded-lg border border-[#004526] py-2.5 text-sm font-medium text-[#004526] hover:bg-[#EBF7F1] disabled:opacity-40"
          >
            {exportLoading ? 'Preparing...' : 'Download my data'}
          </button>
          {exportUrl && (
            <a href={exportUrl} target="_blank" rel="noopener noreferrer"
              className="text-sm text-[#006B3C] underline text-center">
              Download ready (valid 24h)
            </a>
          )}
          <button
            type="button"
            data-testid="delete-account-btn"
            onClick={async () => {
              setDeleteBlockError('');
              const token = await getAuthToken();
              // Pre-check for blocking bookings
              const res = await fetch(`${API_URL}/api/v1/users/me/delete-check`, {
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => null);
              if (res && !res.ok) {
                const body = await res.json().catch(() => ({}));
                if (body.error === 'ACTIVE_BOOKINGS_EXIST') {
                  setDeleteBlockError(`You have ${body.blockingBookings?.length ?? 'active'} booking(s) that must be completed or cancelled before deletion.`);
                  return;
                }
                if (body.error === 'OPEN_DISPUTES_EXIST') {
                  setDeleteBlockError('You have open disputes that must be resolved before deletion.');
                  return;
                }
              }
              setShowDeleteModal(true);
            }}
            className="w-full rounded-lg border border-[#AD3614] py-2.5 text-sm font-medium text-[#AD3614] hover:bg-red-50"
          >
            Delete my account
          </button>
          {deleteBlockError && (
            <p data-testid="blocking-bookings-banner" className="text-sm text-[#AD3614] bg-red-50 p-3 rounded-lg">
              {deleteBlockError}
            </p>
          )}
        </div>
      </div>

      {showDeleteModal && user && (
        <DeleteAccountModal
          userEmail={user.email}
          token=""
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => router.push('/')}
        />
      )}

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
