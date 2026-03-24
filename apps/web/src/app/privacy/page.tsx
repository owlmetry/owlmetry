import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Privacy Policy — OwlMetry",
  description:
    "Learn how OwlMetry collects, uses, and protects your data. Privacy policy for the OwlMetry analytics platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <MarketingNav />
      <main
        className="min-h-screen pt-14"
        style={{ background: "oklch(0.12 0.015 55)" }}
      >
        <div className="mx-auto max-w-4xl px-6 py-16">
          <article className="prose prose-invert prose-lg max-w-none prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-p:text-white/70 prose-p:leading-relaxed prose-li:text-white/70 prose-strong:text-white/90 prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline prose-ul:my-4 prose-li:my-1">
            <h1>Privacy Policy</h1>
            <p className="text-white/40 !mt-2 !mb-12 text-base">
              Effective date: March 24, 2026
            </p>

            <h2>Who We Are</h2>
            <p>
              Adapted Hub LLC operates OwlMetry, an analytics platform for
              mobile and backend applications. OwlMetry is available as a hosted
              service at{" "}
              <a href="https://owlmetry.com">owlmetry.com</a> and as
              self-hosted open-source software.
            </p>

            <h2>Information We Collect</h2>

            <h3>Platform Users (You)</h3>
            <p>
              When you create an OwlMetry account, we collect the following
              information:
            </p>
            <ul>
              <li>
                <strong>Email address</strong> — used as your login identifier
              </li>
              <li>
                <strong>Name</strong> — auto-generated from your email address
                and editable in your profile
              </li>
            </ul>
            <p>
              Authentication is passwordless. We send a 6-digit verification
              code to your email when you sign in. Verification codes are hashed
              before storage and expire after 10 minutes.
            </p>

            <h3>End-User Data (Your Application&apos;s Users)</h3>
            <p>
              When your application uses our SDKs, the following data may be
              collected about your end users:
            </p>
            <ul>
              <li>
                <strong>Device information:</strong> device model, OS version,
                locale
              </li>
              <li>
                <strong>App information:</strong> app version, build number,
                bundle identifier
              </li>
              <li>
                <strong>Session data:</strong> session identifier (UUID,
                generated fresh on each app launch)
              </li>
              <li>
                <strong>User identifiers:</strong> anonymous ID
                (auto-generated) or user ID (if you call our identity API)
              </li>
              <li>
                <strong>Event data:</strong> log level, message, screen name,
                timestamps
              </li>
              <li>
                <strong>Custom attributes:</strong> key-value pairs that you
                explicitly send
              </li>
              <li>
                <strong>Experiment assignments:</strong> A/B test variant
                assignments
              </li>
              <li>
                <strong>Network connection type</strong> (Swift SDK only,
                opt-in)
              </li>
            </ul>

            <h3>What We Do Not Collect</h3>
            <ul>
              <li>IP addresses</li>
              <li>GPS or precise location data</li>
              <li>Biometric data</li>
              <li>Browser fingerprints</li>
              <li>Advertising identifiers</li>
              <li>Contact lists, photos, or other device content</li>
            </ul>

            <h2>How We Use Your Information</h2>
            <ul>
              <li>Provide and operate the OwlMetry analytics service</li>
              <li>Authenticate your account and maintain your session</li>
              <li>
                Send verification codes and team invitation emails
              </li>
              <li>Monitor service health and prevent abuse</li>
            </ul>
            <p>
              We do not use your data for advertising, profiling, or any purpose
              other than providing the service.
            </p>

            <h2>Data Storage and Security</h2>
            <ul>
              <li>
                Data is stored in a PostgreSQL database hosted on DigitalOcean
                infrastructure in the United States
              </li>
              <li>
                API keys are SHA-256 hashed before storage — full keys are shown
                only once at creation
              </li>
              <li>Email verification codes are hashed before storage</li>
              <li>
                Authentication uses HTTP-only, secure cookies that are
                inaccessible to JavaScript
              </li>
              <li>
                The API is protected by rate limiting and request size guards
              </li>
              <li>
                All data in transit is encrypted via TLS (HTTPS)
              </li>
            </ul>
            <p>
              If you self-host OwlMetry, your data stays entirely on your own
              infrastructure.
            </p>

            <h2>Data Retention</h2>
            <ul>
              <li>
                Event data is retained until you delete it or until automatic
                pruning removes it (if you have configured a database size limit
                on your self-hosted instance)
              </li>
              <li>
                Deleted resources (projects, apps, API keys) are soft-deleted
                and permanently removed after 7 days
              </li>
              <li>Email verification codes expire after 10 minutes</li>
              <li>
                Database backups are retained for 7 days on the hosted service
              </li>
              <li>Team invitations expire after 7 days</li>
            </ul>

            <h2>Third-Party Services</h2>
            <p>
              We use a minimal set of third-party services. We do not use any
              analytics, advertising, or tracking services on our own platform.
            </p>
            <ul>
              <li>
                <strong>Resend</strong> — email delivery for verification codes
                and team invitations
              </li>
              <li>
                <strong>Cloudflare</strong> — CDN, SSL termination, and DDoS
                protection
              </li>
              <li>
                <strong>DigitalOcean</strong> — infrastructure hosting
              </li>
            </ul>

            <h2>Cookies</h2>
            <p>OwlMetry uses a single authentication cookie:</p>
            <ul>
              <li>
                <strong>Name:</strong> <code>token</code>
              </li>
              <li>
                <strong>Purpose:</strong> maintains your authenticated session
              </li>
              <li>
                <strong>Type:</strong> HTTP-only, secure, SameSite=Lax
              </li>
              <li>
                <strong>Duration:</strong> 7 days
              </li>
            </ul>
            <p>
              This cookie is strictly necessary for the service to function. We
              do not use any tracking, analytics, or advertising cookies.
            </p>

            <h2>Our Role as a Data Processor</h2>
            <p>
              When you use OwlMetry to collect data about your application&apos;s
              users, you are the data controller and OwlMetry acts as a data
              processor (under GDPR) or service provider (under CCPA). This
              means:
            </p>
            <ul>
              <li>
                You determine what data is collected from your users and why
              </li>
              <li>
                We process that data solely to provide the OwlMetry service to
                you
              </li>
              <li>
                We do not sell, share, or use your end-user data for any purpose
                other than providing the service
              </li>
              <li>
                You are responsible for obtaining any necessary consents from
                your end users and for complying with applicable privacy laws
              </li>
            </ul>

            <h2>Your Rights Under GDPR</h2>
            <p>
              If you are located in the European Economic Area, you have the
              right to:
            </p>
            <ul>
              <li>
                <strong>Access</strong> your personal data
              </li>
              <li>
                <strong>Correct</strong> inaccurate personal data
              </li>
              <li>
                <strong>Delete</strong> your personal data
              </li>
              <li>
                <strong>Port</strong> your data to another service in a
                machine-readable format
              </li>
              <li>
                <strong>Restrict</strong> processing of your personal data
              </li>
              <li>
                <strong>Object</strong> to processing of your personal data
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>.
              We will respond within 30 days.
            </p>

            <h2>Your Rights Under CCPA</h2>
            <p>
              If you are a California resident, you have the right to:
            </p>
            <ul>
              <li>
                <strong>Know</strong> what personal information we collect and
                how we use it
              </li>
              <li>
                <strong>Delete</strong> your personal information
              </li>
              <li>
                <strong>Opt out of the sale</strong> of your personal
                information — we do not sell personal information
              </li>
              <li>
                <strong>Non-discrimination</strong> for exercising your privacy
                rights
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>.
            </p>

            <h2>International Data Transfers</h2>
            <p>
              Data collected through the hosted service is stored in the United
              States. If you are located outside the United States, your data
              will be transferred to and processed in the United States. We rely
              on standard contractual clauses where required for lawful
              international data transfers.
            </p>

            <h2>Children&apos;s Privacy</h2>
            <p>
              OwlMetry is not directed at children under 16 years of age. We do
              not knowingly collect personal information from children under 16.
              If you believe we have collected information from a child under 16,
              please contact us at{" "}
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>{" "}
              and we will promptly delete it.
            </p>

            <h2>Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. The effective
              date at the top of this page indicates when the policy was last
              revised. If we make material changes, we will notify you by email.
            </p>

            <h2>Contact Us</h2>
            <p>
              If you have questions about this privacy policy or our data
              practices, contact us at:
            </p>
            <p>
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>
            </p>
          </article>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
