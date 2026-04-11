'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

import { blockApi } from '../../../../lib/apiUrls';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

interface SettlementData {
  totalEur: number;
  capturedEur: number;
  refundedEur: number;
  settledAt?: string | null;
  perAllocation: {
    allocId: string;
    poolName?: string;
    poolListingId?: string;
    contributedBayCount: number;
    allocatedBayCount: number;
    riskShareMode?: string;
    riskShareRate?: number;
    pricePerBayEur?: number;
    amountEur: number;
    platformFeeEur: number;
    netToSpotManagerEur?: number;
  }[];
}

// Belgian standard VAT rate. Amounts stored in the settlement breakdown are
// VAT-inclusive (TTC); HT and VAT are derived for invoice display.
const VAT_RATE = 0.21;
const splitVat = (ttc: number) => {
  const ht = Math.round((ttc / (1 + VAT_RATE)) * 100) / 100;
  const vat = Math.round((ttc - ht) * 100) / 100;
  return { ht, vat, ttc: Math.round(ttc * 100) / 100 };
};

function exportCsv(reqId: string, data: SettlementData) {
  const headers = [
    'Allocation ID',
    'Pool',
    'Contracted bays',
    'Allocated bays',
    'Risk share mode',
    'Price per bay (€ TTC)',
    'Amount HT (€)',
    'VAT 21% (€)',
    'Amount TTC (€)',
    'Platform fee HT (€)',
    'Platform fee VAT (€)',
    'Platform fee TTC (€)',
    'Net to SM HT (€)',
    'Net to SM VAT (€)',
    'Net to SM TTC (€)',
    'Transfer ID',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = data.perAllocation.map((a) => {
    const amt = splitVat(a.amountEur ?? 0);
    const fee = splitVat(a.platformFeeEur ?? 0);
    const netTtc = a.netToSpotManagerEur ?? ((a.amountEur ?? 0) - (a.platformFeeEur ?? 0));
    const net = splitVat(netTtc);
    return [
      a.allocId,
      a.poolName ?? a.poolListingId ?? '',
      a.contributedBayCount,
      a.allocatedBayCount,
      a.riskShareMode ?? '',
      (a.pricePerBayEur ?? 0).toFixed(2),
      amt.ht.toFixed(2),
      amt.vat.toFixed(2),
      amt.ttc.toFixed(2),
      fee.ht.toFixed(2),
      fee.vat.toFixed(2),
      fee.ttc.toFixed(2),
      net.ht.toFixed(2),
      net.vat.toFixed(2),
      net.ttc.toFixed(2),
      (a as unknown as { transferId?: string }).transferId ?? '',
    ].map(escape).join(',');
  });

  // Summary footer — sum TTC values, then derive HT + VAT on the totals
  const totalAmtTtc = data.perAllocation.reduce((s, a) => s + (a.amountEur ?? 0), 0);
  const totalFeeTtc = data.perAllocation.reduce((s, a) => s + (a.platformFeeEur ?? 0), 0);
  const totalNetTtc = data.perAllocation.reduce(
    (s, a) => s + (a.netToSpotManagerEur ?? (a.amountEur ?? 0) - (a.platformFeeEur ?? 0)),
    0,
  );
  const amtTot = splitVat(totalAmtTtc);
  const feeTot = splitVat(totalFeeTtc);
  const netTot = splitVat(totalNetTtc);

  const totals = [
    '',
    'TOTAL',
    data.perAllocation.reduce((s, a) => s + a.contributedBayCount, 0),
    data.perAllocation.reduce((s, a) => s + a.allocatedBayCount, 0),
    '',
    '',
    amtTot.ht.toFixed(2),
    amtTot.vat.toFixed(2),
    amtTot.ttc.toFixed(2),
    feeTot.ht.toFixed(2),
    feeTot.vat.toFixed(2),
    feeTot.ttc.toFixed(2),
    netTot.ht.toFixed(2),
    netTot.vat.toFixed(2),
    netTot.ttc.toFixed(2),
    '',
  ].map(escape).join(',');

  const csv = [headers.join(','), ...rows, totals].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `spotzy-block-${reqId}-settlement.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function printInvoice(reqId: string, data: SettlementData) {
  // Open a new window with a print-friendly invoice layout and trigger the
  // browser print dialog. The user can then "Save as PDF" from the dialog.
  const settledDate = data.settledAt ? new Date(data.settledAt).toLocaleDateString() : '';
  const rows = data.perAllocation.map((a) => {
    const amt = splitVat(a.amountEur ?? 0);
    const fee = splitVat(a.platformFeeEur ?? 0);
    const netTtc = a.netToSpotManagerEur ?? ((a.amountEur ?? 0) - (a.platformFeeEur ?? 0));
    const net = splitVat(netTtc);
    return `
      <tr>
        <td>${a.poolName ?? a.poolListingId ?? 'Pool'}</td>
        <td>${a.riskShareMode ?? ''}</td>
        <td style="text-align:right">${a.contributedBayCount} / ${a.allocatedBayCount}</td>
        <td style="text-align:right">€${amt.ht.toFixed(2)}</td>
        <td style="text-align:right">€${amt.vat.toFixed(2)}</td>
        <td style="text-align:right"><strong>€${amt.ttc.toFixed(2)}</strong></td>
        <td style="text-align:right">€${fee.ttc.toFixed(2)}<br><span style="color:#999;font-size:10px">HT €${fee.ht.toFixed(2)} + VAT €${fee.vat.toFixed(2)}</span></td>
        <td style="text-align:right">€${net.ttc.toFixed(2)}<br><span style="color:#999;font-size:10px">HT €${net.ht.toFixed(2)} + VAT €${net.vat.toFixed(2)}</span></td>
      </tr>`;
  }).join('');

  const totalAmtTtc = data.perAllocation.reduce((s, a) => s + (a.amountEur ?? 0), 0);
  const totalFeeTtc = data.perAllocation.reduce((s, a) => s + (a.platformFeeEur ?? 0), 0);
  const totalNetTtc = data.perAllocation.reduce(
    (s, a) => s + (a.netToSpotManagerEur ?? (a.amountEur ?? 0) - (a.platformFeeEur ?? 0)),
    0,
  );
  const amtTot = splitVat(totalAmtTtc);
  const feeTot = splitVat(totalFeeTtc);
  const netTot = splitVat(totalNetTtc);

  const html = `<!doctype html><html><head>
    <meta charset="utf-8">
    <title>Spotzy Block Reservation Invoice - ${reqId}</title>
    <style>
      body { font-family: -apple-system, Inter, sans-serif; color: #1a1a1a; max-width: 800px; margin: 40px auto; padding: 0 24px; }
      h1 { color: #004526; font-size: 24px; margin: 0 0 8px 0; }
      .header { border-bottom: 3px solid #004526; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
      .meta { color: #666; font-size: 14px; line-height: 1.6; }
      .totals { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin: 24px 0; }
      .totals .box { padding: 16px; background: #f0faf4; border-radius: 8px; }
      .totals .box p:first-child { color: #666; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px; }
      .totals .box p:last-child { font-size: 22px; font-weight: 700; color: #004526; margin: 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
      th { background: #004526; color: white; padding: 10px 8px; text-align: left; font-weight: 600; }
      th:nth-child(n+3) { text-align: right; }
      td { padding: 10px 8px; border-bottom: 1px solid #e5e5e5; }
      tfoot td { background: #f0faf4; font-weight: 700; border-top: 2px solid #004526; }
      .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #999; font-size: 11px; line-height: 1.5; }
      @media print { body { margin: 0; } @page { margin: 16mm; } }
    </style>
  </head><body>
    <div class="header">
      <div>
        <h1>Block Reservation Settlement</h1>
        <div class="meta">
          Request ID: ${reqId}<br>
          ${settledDate ? `Settled on ${settledDate}` : ''}
        </div>
      </div>
      <div class="meta" style="text-align:right">
        <strong>Spotzy</strong><br>
        Brussels, Belgium<br>
        spotzy.com
      </div>
    </div>

    <div class="totals">
      <div class="box">
        <p>Authorised</p>
        <p>€${(data.totalEur ?? 0).toFixed(2)}</p>
      </div>
      <div class="box">
        <p>Captured</p>
        <p>€${(data.capturedEur ?? 0).toFixed(2)}</p>
      </div>
      <div class="box">
        <p>Refunded</p>
        <p>€${(data.refundedEur ?? 0).toFixed(2)}</p>
      </div>
    </div>

    <h2 style="color:#004526; font-size:16px; margin:24px 0 8px 0">Allocation breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>Pool</th>
          <th>Risk share</th>
          <th>Bays</th>
          <th>Amount HT</th>
          <th>VAT 21%</th>
          <th>Amount TTC</th>
          <th>Platform fee</th>
          <th>Net to SM</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">Total</td>
          <td style="text-align:right">€${amtTot.ht.toFixed(2)}</td>
          <td style="text-align:right">€${amtTot.vat.toFixed(2)}</td>
          <td style="text-align:right">€${amtTot.ttc.toFixed(2)}</td>
          <td style="text-align:right">€${feeTot.ttc.toFixed(2)}</td>
          <td style="text-align:right">€${netTot.ttc.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>

    <h2 style="color:#004526; font-size:16px; margin:32px 0 8px 0">VAT summary</h2>
    <table style="max-width: 500px">
      <thead>
        <tr>
          <th>Line</th>
          <th>HT</th>
          <th>VAT 21%</th>
          <th>TTC</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total charged to Block Spotter</td>
          <td style="text-align:right">€${amtTot.ht.toFixed(2)}</td>
          <td style="text-align:right">€${amtTot.vat.toFixed(2)}</td>
          <td style="text-align:right"><strong>€${amtTot.ttc.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td>Spotzy platform fee</td>
          <td style="text-align:right">€${feeTot.ht.toFixed(2)}</td>
          <td style="text-align:right">€${feeTot.vat.toFixed(2)}</td>
          <td style="text-align:right">€${feeTot.ttc.toFixed(2)}</td>
        </tr>
        <tr>
          <td>Net to Spot Manager(s)</td>
          <td style="text-align:right">€${netTot.ht.toFixed(2)}</td>
          <td style="text-align:right">€${netTot.vat.toFixed(2)}</td>
          <td style="text-align:right">€${netTot.ttc.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      This document is an informational settlement summary generated by the Spotzy platform.
      Amounts shown are in EUR and VAT-inclusive (TTC) unless otherwise noted. The Belgian
      standard VAT rate of 21% applies. Platform fees are deducted from each allocation before
      the net amount is transferred to the respective Spot Manager via Stripe Connect.
      For support, contact support@spotzy.be.
    </div>

    <script>
      window.addEventListener('load', () => { setTimeout(() => window.print(), 300); });
    </script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to download the invoice.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

export default function SettlementPage() {
  const router = useRouter();
  const params = useParams();
  const reqId = params.reqId as string;
  const [data, setData] = useState<SettlementData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const detail = await res.json();
        setData(detail.settlementBreakdown);
      }
      setLoading(false);
    }
    load();
  }, [reqId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Settlement not yet available.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push(`/block-requests/${reqId}`)} className="text-[#004526] text-sm mb-4 hover:underline">
          &larr; Back to request
        </button>

        {/* Header card */}
        <div className="bg-gradient-to-r from-[#004526] to-[#006B3C] rounded-xl p-6 mb-6 text-white">
          <p className="text-sm opacity-80">
            Settled{data.settledAt ? ` on ${new Date(data.settledAt).toLocaleDateString()}` : ''}
          </p>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div>
              <p className="text-sm opacity-80">Authorised</p>
              <p className="text-2xl font-bold">{'\u20AC'}{(data.totalEur ?? 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm opacity-80">Captured</p>
              <p className="text-2xl font-bold">{'\u20AC'}{(data.capturedEur ?? 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm opacity-80">Refunded</p>
              <p className="text-2xl font-bold">{'\u20AC'}{(data.refundedEur ?? 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Per-allocation breakdown */}
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Allocation Breakdown</h2>
        <div className="space-y-4">
          {data.perAllocation.map(alloc => {
            const netToSpotManager = alloc.netToSpotManagerEur
              ?? (alloc.amountEur - (alloc.platformFeeEur ?? 0));
            return (
              <div key={alloc.allocId} className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{alloc.poolName ?? alloc.poolListingId ?? 'Pool'}</h3>
                  {alloc.riskShareMode && (
                    <span className="text-sm text-gray-500">{alloc.riskShareMode}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-gray-500">Contracted:</span> <span className="font-medium">{alloc.contributedBayCount} bays</span></div>
                  <div><span className="text-gray-500">Allocated:</span> <span className="font-medium">{alloc.allocatedBayCount} bays</span></div>
                  {alloc.pricePerBayEur != null && (
                    <div><span className="text-gray-500">Rate:</span> <span className="font-medium">{'\u20AC'}{alloc.pricePerBayEur.toFixed(2)}/bay</span></div>
                  )}
                  <div><span className="text-gray-500">Amount:</span> <span className="font-medium">{'\u20AC'}{(alloc.amountEur ?? 0).toFixed(2)}</span></div>
                </div>
                {/* Risk share visualization */}
                <div className="mt-3">
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <span>Fill rate: {alloc.contributedBayCount > 0 ? Math.round(alloc.allocatedBayCount / alloc.contributedBayCount * 100) : 0}%</span>
                  </div>
                  <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#004526] rounded-full"
                      style={{ width: `${alloc.contributedBayCount > 0 ? (alloc.allocatedBayCount / alloc.contributedBayCount) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                {(() => {
                  const fee = splitVat(alloc.platformFeeEur ?? 0);
                  const net = splitVat(netToSpotManager);
                  const amt = splitVat(alloc.amountEur ?? 0);
                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
                      <div className="flex justify-between">
                        <span>Amount (HT / VAT 21% / TTC):</span>
                        <span className="font-mono">€{amt.ht.toFixed(2)} + €{amt.vat.toFixed(2)} = <strong>€{amt.ttc.toFixed(2)}</strong></span>
                      </div>
                      <div className="flex justify-between">
                        <span>Platform fee (HT / VAT / TTC):</span>
                        <span className="font-mono">€{fee.ht.toFixed(2)} + €{fee.vat.toFixed(2)} = €{fee.ttc.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Net to Spot Manager (HT / VAT / TTC):</span>
                        <span className="font-mono">€{net.ht.toFixed(2)} + €{net.vat.toFixed(2)} = €{net.ttc.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => printInvoice(reqId, data)}
            className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold hover:bg-[#003a1f]"
          >
            Download Invoice (PDF)
          </button>
          <button
            onClick={() => exportCsv(reqId, data)}
            className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>

        <p className="mt-4 text-sm text-gray-400 text-center">
          <a href="#" className="hover:underline">Something looks wrong?</a>
        </p>
      </div>
    </main>
  );
}
