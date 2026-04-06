'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdminGuard } from '../../../components/AdminGuard';
import { useAuth } from '../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Customer {
  userId: string;
  displayName: string;
  fullName: string;
  email: string;
  personas: string[];
  rating: number;
  listingCount: number;
  bookingCount: number;
  disputeCount?: number;
}

type Filter = 'all' | 'hosts' | 'has_disputes';
type SortDir = 'asc' | 'desc';

function CustomersContent() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState('displayName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchCustomers = useCallback(
    (searchTerm: string) => {
      if (!user) return;
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      if (filter !== 'all') params.set('filter', filter);
      if (searchTerm) params.set('search', searchTerm);

      fetch(`${API_URL}/api/v1/admin/customers?${params}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
        .then((r) => r.json())
        .then((d: any) => {
          setCustomers(d.customers ?? []);
          setTotal(d.total ?? 0);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    },
    [user?.userId, page, sortBy, sortDir, filter],
  );

  useEffect(() => {
    fetchCustomers(search);
  }, [fetchCustomers]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchCustomers(value);
    }, 300);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 25));

  const filters: { label: string; value: Filter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Hosts', value: 'hosts' },
    { label: 'Has disputes', value: 'has_disputes' },
  ];

  const columns = [
    { key: 'displayName', label: 'Name' },
    { key: 'personas', label: 'Personas' },
    { key: 'rating', label: 'Rating' },
    { key: 'listingCount', label: 'Listings' },
    { key: 'bookingCount', label: 'Bookings' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#004526] mb-6">Customers</h1>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          aria-label="Search customers"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by name or email..."
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#006B3C]"
        />
        <div className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-[#006B3C] text-white'
                  : 'bg-white text-[#004526] border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  role="columnheader"
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left font-semibold text-[#004526] cursor-pointer hover:bg-gray-100 select-none"
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.userId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/backoffice/customers/${c.userId}`}
                    className="text-[#006B3C] font-medium hover:underline"
                  >
                    {c.displayName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {c.personas.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-0.5 rounded-full bg-[#004526]/10 text-[#004526]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">{c.rating?.toFixed(1) ?? '-'}</td>
                <td className="px-4 py-3">{c.listingCount}</td>
                <td className="px-4 py-3">{c.bookingCount}</td>
              </tr>
            ))}
            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-gray-500">
          Page {page} of {totalPages} ({total} total)
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BackofficeCustomersPage() {
  return (
    <AdminGuard>
      <CustomersContent />
    </AdminGuard>
  );
}
