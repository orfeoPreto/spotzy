export function generateStaticParams() { return [{ corpId: '_' }]; }

export default function InvoicesPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-[#004526] mb-6">Invoices</h1>
      <p className="text-sm text-[#4B6354]">Invoice history will appear here once bookings are completed.</p>
    </main>
  );
}
