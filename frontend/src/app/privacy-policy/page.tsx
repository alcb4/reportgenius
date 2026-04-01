import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — ReportGenius",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <nav className="mb-8 text-sm text-gray-500">
          <Link href="/login" className="hover:text-gray-900">← Back to login</Link>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: March 2026</p>

        <div className="prose prose-gray max-w-none space-y-8">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Who We Are</h2>
            <p className="text-gray-700">
              ReportGenius is an open-source school report generation tool for teachers.
              It helps teachers write professional end-of-term reports quickly using AI assistance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">What Data We Collect</h2>
            <ul className="list-disc pl-5 space-y-2 text-gray-700">
              <li>Your name and email address (account registration)</li>
              <li>Your school or organisation name</li>
              <li>Student data you enter: first name, last name, reference ID, gender, ratings, and report text</li>
            </ul>
            <p className="text-gray-700 mt-3">
              We do <strong>not</strong> collect student passwords, contact details, parent information,
              or any other sensitive personal data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Why We Collect It</h2>
            <p className="text-gray-700">
              Solely to provide the report generation service. Student data is entered and controlled
              entirely by you, the teacher. You are the data controller for any student data you enter —
              we are the data processor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Where Data Is Stored</h2>
            <p className="text-gray-700">
              Data is stored on Supabase (PostgreSQL) servers. Supabase infrastructure is hosted on
              AWS EU regions. API keys you configure are encrypted at rest using AES-256-GCM before storage.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">How Long We Keep It</h2>
            <ul className="list-disc pl-5 space-y-2 text-gray-700">
              <li>Sessions and reports: current academic year + 1 year</li>
              <li>Student ratings: same as above</li>
              <li>Account data: while your account is active</li>
              <li>All data: permanently deleted within 30 days of account deletion</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Your Rights (UK GDPR)</h2>
            <p className="text-gray-700 mb-3">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-2 text-gray-700">
              <li>Access your data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and all associated data (via Settings → Delete Account)</li>
              <li>Data portability — XLSX export is available from any session</li>
            </ul>
            <p className="text-gray-700 mt-3">
              As the teacher, you are responsible for ensuring you have appropriate authorisation from
              your school to enter student data into third-party systems.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Cookies</h2>
            <p className="text-gray-700">
              We use only essential session cookies for authentication. No tracking,
              advertising, or analytics cookies are used.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Contact</h2>
            <p className="text-gray-700">
              This is an open-source project. To report a data concern or request data deletion,
              please open an issue on our GitHub repository.
            </p>
          </section>

        </div>

        <footer className="mt-12 pt-8 border-t border-gray-200 flex gap-4 text-sm text-gray-500">
          <Link href="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-900">Terms & Conditions</Link>
        </footer>
      </div>
    </div>
  );
}
