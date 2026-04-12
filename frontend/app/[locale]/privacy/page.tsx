export const dynamic = 'force-static';

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-[#004526] mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#4B6354] mb-8">Version: 2026-04-01 | Last updated: April 2026</p>

      <section className="space-y-8 text-sm text-[#1C2B1A] leading-relaxed">
        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">1. Data we collect</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Account information: name, email, phone number, display name (pseudo), profile photo</li>
            <li>Billing information: Stripe Connect account details (hosts), payment methods (spotters)</li>
            <li>Booking data: dates, times, locations, prices, status</li>
            <li>Chat messages between hosts and spotters</li>
            <li>Reviews and ratings</li>
            <li>Dispute records and communications</li>
            <li>Usage data: search queries, preferences, login history</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">2. How we use it</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>To operate the Spotzy parking marketplace</li>
            <li>To process bookings and payments</li>
            <li>To communicate with you about your bookings</li>
            <li>To improve our services through anonymous analytics</li>
            <li>To comply with legal obligations (Belgian accounting law)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">3. How long we keep it</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#EBF7F1]">
                  <th className="text-left px-4 py-2 border border-[#C8DDD2]">Data type</th>
                  <th className="text-left px-4 py-2 border border-[#C8DDD2]">Retention period</th>
                  <th className="text-left px-4 py-2 border border-[#C8DDD2]">Legal basis</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Profile and personal information</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Until account deletion</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">GDPR Art. 17</td>
                </tr>
                <tr className="bg-[#F8FBF9]">
                  <td className="px-4 py-2 border border-[#C8DDD2]">Booking and payment records</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">7 years from booking date</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Belgian law (Code des soci&eacute;t&eacute;s)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Chat messages</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">1 year from booking end</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Platform operations</td>
                </tr>
                <tr className="bg-[#F8FBF9]">
                  <td className="px-4 py-2 border border-[#C8DDD2]">Reviews</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Until account deletion (author anonymised)</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Platform integrity</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Disputes</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">7 years from dispute date</td>
                  <td className="px-4 py-2 border border-[#C8DDD2]">Accounting + legal</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">4. Your rights</h2>
          <p className="mb-3">Under the General Data Protection Regulation (GDPR), you have the right to:</p>
          <ul className="list-disc list-inside space-y-1 mb-4">
            <li><strong>Access</strong> your data — view your profile and booking history at any time</li>
            <li><strong>Portability</strong> — download all your data in a machine-readable format</li>
            <li><strong>Rectification</strong> — correct inaccurate personal data via your profile page</li>
            <li><strong>Erasure</strong> — request deletion of your account and personal data</li>
            <li><strong>Object</strong> — object to processing of your data for specific purposes</li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/profile"
              className="inline-block px-4 py-2 bg-[#004526] text-white rounded-lg text-center font-medium text-sm"
            >
              Delete your account
            </a>
            <a
              href="/profile"
              className="inline-block px-4 py-2 border border-[#004526] text-[#004526] rounded-lg text-center font-medium text-sm"
            >
              Download your data
            </a>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">5. Contact</h2>
          <p>
            If you have questions about your privacy or wish to exercise your rights, contact our Data Protection Officer:
          </p>
          <p className="mt-2 font-medium">
            <a href="mailto:dpo@spotzy.com" className="text-[#006B3C] underline">dpo@spotzy.com</a>
          </p>
          <p className="mt-4 text-xs text-[#4B6354]">
            Spotzy is operated by Exu Consult, registered in Belgium. For complaints, you may also contact the Belgian Data Protection Authority (Autorit&eacute; de protection des donn&eacute;es).
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#004526] mb-3">6. Changes to this policy</h2>
          <p>
            We may update this privacy policy from time to time. When we do, we will update the version date at the top of this page. Significant changes will be communicated via email.
          </p>
        </div>
      </section>
    </main>
  );
}
