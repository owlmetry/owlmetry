import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata = {
  title: "Terms of Service — OwlMetry",
  description:
    "Terms of Service for OwlMetry, the agent-first observability platform for mobile and backend applications.",
};

export default function TermsPage() {
  return (
    <>
      <MarketingNav />
      <main className="pt-14" style={{ background: "oklch(0.12 0.015 55)" }}>
        <div className="mx-auto max-w-4xl px-6 py-16">
          <article className="prose prose-invert prose-lg max-w-none prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-p:text-white/70 prose-p:leading-relaxed prose-li:text-white/70 prose-strong:text-white/90 prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline prose-ul:my-4 prose-li:my-1">
            <h1>Terms of Service</h1>
            <p>
              <strong>Effective date:</strong> March 24, 2026
            </p>

            <h2>Agreement to Terms</h2>
            <p>
              By accessing or using OwlMetry (the hosted service at owlmetry.com
              or the self-hosted software), you agree to be bound by these Terms
              of Service. If you do not agree to these terms, do not use the
              service.
            </p>
            <p>
              &ldquo;We,&rdquo; &ldquo;us,&rdquo; and &ldquo;our&rdquo; refer
              to Adapted Hub LLC. &ldquo;You&rdquo; and &ldquo;your&rdquo; refer
              to the person or entity using the service.
            </p>

            <h2>Service Description</h2>
            <p>
              OwlMetry is an analytics platform for mobile and backend
              applications. It includes a hosted service at owlmetry.com,
              self-hosted open-source software, client SDKs (Swift, Node.js), a
              command-line interface (CLI), and an API. These terms govern your
              use of all OwlMetry products and services.
            </p>

            <h2>Accounts</h2>
            <p>
              You must provide a valid email address to create an account.
              Authentication is passwordless via email verification codes. You
              are responsible for maintaining the security of your account and
              API keys. You must not share your account with others. You must
              promptly notify us if you become aware of unauthorized access to
              your account.
            </p>

            <h2>Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the service for any unlawful purpose</li>
              <li>
                Attempt to gain unauthorized access to the service or other
                users&apos; data
              </li>
              <li>
                Interfere with or disrupt the service or its infrastructure
              </li>
              <li>
                Circumvent rate limits or other technical restrictions
              </li>
              <li>
                Use the service to collect data in violation of applicable
                privacy laws
              </li>
              <li>
                Transmit malware, viruses, or harmful code through the service
              </li>
              <li>
                Scrape, crawl, or otherwise extract data from the service except
                through our APIs
              </li>
            </ul>

            <h2>Your Data</h2>
            <p>
              You retain all ownership rights to data you submit to OwlMetry.
              You grant us a limited, non-exclusive license to process your data
              solely to provide the service. We will not sell, share, or use your
              data for any purpose other than operating the service.
            </p>
            <p>
              When you delete data or terminate your account, we will delete your
              data in accordance with our privacy policy.
            </p>
            <p>
              You are solely responsible for the data you collect from your end
              users, including obtaining any required consents and complying with
              applicable privacy laws.
            </p>

            <h2>Open Source Software</h2>
            <p>
              The OwlMetry platform (server, web dashboard, database layer) is
              released under the GNU Affero General Public License v3.0
              (AGPL-3.0). The OwlMetry SDKs and CLI are released under the MIT
              License. Your use of the self-hosted software is governed by those
              licenses. Your use of the hosted service at owlmetry.com is
              governed by these Terms of Service.
            </p>

            <h2>Intellectual Property</h2>
            <p>
              The OwlMetry name, logo, and branding are the property of Adapted
              Hub LLC. The open-source code is licensed under the applicable
              open-source license. Nothing in these terms grants you rights to
              our trademarks or branding.
            </p>

            <h2>API and Rate Limits</h2>
            <p>
              Access to the OwlMetry API is subject to rate limits. We may
              throttle or suspend access if we determine that usage is abusive or
              places an unreasonable burden on the service. Current rate limits
              are documented in our API documentation.
            </p>

            <h2>Service Availability</h2>
            <p>
              We strive to maintain high availability but do not guarantee
              uninterrupted or error-free service. The service is provided on an
              &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We may
              perform maintenance, updates, or modifications that temporarily
              affect availability. We will make reasonable efforts to provide
              advance notice of planned downtime.
            </p>

            <h2>Termination</h2>
            <p>
              You may stop using the service at any time. To delete your account,
              contact{" "}
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>.
            </p>
            <p>
              We may suspend or terminate your access if you violate these terms,
              if your use poses a security risk, or if required by law. Upon
              termination, your right to use the service ceases immediately.
            </p>

            <h2>Disclaimer of Warranties</h2>
            <p className="uppercase">
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF
              ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
              WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
              UNINTERRUPTED, SECURE, OR ERROR-FREE.
            </p>

            <h2>Limitation of Liability</h2>
            <p className="uppercase">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, ADAPTED HUB LLC SHALL NOT
              BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
              PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL,
              ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY
              CLAIMS ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE
              AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR ONE
              HUNDRED DOLLARS ($100), WHICHEVER IS GREATER.
            </p>

            <h2>Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Adapted Hub LLC from any
              claims, damages, losses, or expenses (including reasonable
              attorneys&apos; fees) arising from your use of the service, your
              violation of these terms, or your collection and processing of
              end-user data.
            </p>

            <h2>Governing Law</h2>
            <p>
              These terms are governed by the laws of the State of Wyoming,
              United States, without regard to conflict of law principles. Any
              disputes arising from these terms shall be resolved in the courts
              located in Wyoming.
            </p>

            <h2>Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. The effective date at
              the top of this page indicates when the terms were last revised. If
              we make material changes, we will notify you by email at least 30
              days before the changes take effect. Your continued use of the
              service after changes take effect constitutes acceptance of the
              updated terms.
            </p>

            <h2>Contact</h2>
            <p>
              If you have questions about these terms, contact us at:{" "}
              <a href="mailto:privacy@owlmetry.com">privacy@owlmetry.com</a>
            </p>
          </article>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
