import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { CopyBlock } from '@/components/CopyBlock';

export const dynamic = 'force-dynamic';

export default async function InstallPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const store = await prisma.store.findFirst({
    where: { id: params.id, userId },
    select: { id: true, name: true, domain: true },
  });
  if (!store) redirect('/stores');

  const baseUrl =
    process.env.APP_BASE_URL?.replace(/\/$/, '') ||
    'https://YOUR-TRACKER-DOMAIN';

  const isWoo = !/myshopify\.com$/i.test(store.domain);
  const wooTag = `<script async src="${baseUrl}/api/script/tracker-woo.js?store_id=${store.id}"></script>`;
  const wooWebhookUrl = `${baseUrl}/api/webhooks/woocommerce/orders`;
  const themeTag = `<script async src="${baseUrl}/api/script/tracker.js?store_id=${store.id}"></script>`;
  const customPixelUrl = `${baseUrl}/api/script/custom-pixel.js?store_id=${store.id}`;
  const webhookUrl = `${baseUrl}/api/webhooks/shopify/orders`;

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <Link
          href={`/stores/${store.id}`}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← {store.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Install instructions</h1>
        <p className="text-sm text-gray-500">{store.domain}</p>
      </div>

      {isWoo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-3">
          <p className="font-medium">WooCommerce-store (domein zonder myshopify.com)</p>
          <p>1. Script in de &lt;head&gt; van het thema (het Laurentide-thema doet dit zelf via Instellingen → Laurentide → Meta Tracker):</p>
          <CopyBlock text={wooTag} />
          <p>2. Order-webhook (server-to-server vanuit WordPress, gesigneerd met het webhook secret van deze store, headers <code>X-MT-Shop-Domain</code> + <code>X-MT-Hmac-Sha256</code>):</p>
          <CopyBlock text={wooWebhookUrl} />
          <p>3. Het domein van deze store moet exact gelijk zijn aan de site-hostname ({store.domain}). De Shopify-stappen hieronder zijn voor deze store niet nodig.</p>
        </div>
      )}

      <Section
        n={1}
        title="Storefront script (theme.liquid)"
        body="Online Store → Themes → ⋯ → Edit code. Open layout/theme.liquid en plak deze script-tag net vóór </head>:"
      >
        <CopyBlock text={themeTag} />
      </Section>

      <Section
        n={2}
        title="Shopify Custom Pixel (checkout & Thank-You)"
        body="Settings → Customer events → Add custom pixel. Open onderstaande URL in een nieuwe tab, kopieer de hele JS-output, en plak in het Code-veld van de Custom Pixel. Activeer (Connect) hem daarna."
      >
        <CopyBlock text={customPixelUrl} />
      </Section>

      <Section
        n={3}
        title="Shopify webhooks"
        body="Settings → Notifications → Webhooks → Create webhook. Maak twee webhooks aan, beide met JSON format en deze URL:"
      >
        <CopyBlock text={webhookUrl} />
        <div className="mt-3 text-sm text-gray-700">
          <p className="mb-2 font-medium">Topics om aan te zetten:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Order creation</strong>
            </li>
            <li>
              <strong>Order paid</strong>
            </li>
          </ul>
          <p className="mt-3 text-gray-600">
            Onder aan de Shopify webhooks-pagina staat het{' '}
            <strong>&quot;Webhook secret signing&quot;</strong>. Klik op
            &quot;Reveal&quot;, kopieer het, en plak het in dit store&apos;s{' '}
            <em>Shopify Webhook Secret</em> veld onder{' '}
            <Link
              href={`/stores/${store.id}`}
              className="text-blue-600 hover:underline"
            >
              Edit
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section
        n={4}
        title="Schakel Shopify's native Meta pixel uit"
        body="Voorkomt dubbele browser events. Drie plekken om te checken:"
      >
        <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 ml-2">
          <li>
            <strong>Online Store → Preferences → Facebook Pixel</strong> —
            leeghalen
          </li>
          <li>
            <strong>
              Settings → Apps and sales channels → Facebook & Instagram
            </strong>{' '}
            — Data sharing op Off of app pauzeren
          </li>
          <li>
            <strong>Settings → Customer events</strong> — verwijder eventuele
            bestaande Meta-pixel die je hier eerder toevoegde
          </li>
        </ul>
        <p className="text-xs text-gray-500 mt-3">
          Als <code className="bg-gray-100 px-1 rounded">window.fbq</code>{' '}
          hierdoor niet bestaat is dat geen probleem — onze tracking leunt op{' '}
          <code className="bg-gray-100 px-1 rounded">/api/collect</code> +
          Meta CAPI. <code className="bg-gray-100 px-1 rounded">fbq()</code> is
          best-effort.
        </p>
      </Section>

      <Section n={5} title="Test stappen">
        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside ml-2">
          <li>
            Open je shop met{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">
              ?fbclid=TESTCLICK123
            </code>{' '}
            in de URL.
          </li>
          <li>
            DevTools → Application → Cookies →{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">_fbp</code>,{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">_fbc</code>,{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">_mt_cid</code>{' '}
            moeten gezet zijn.
          </li>
          <li>
            Console:{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">
              fetch(&apos;/cart.js&apos;).then(r =&gt; r.json()).then(c =&gt;
              console.log(c.attributes))
            </code>{' '}
            — alle <code className="bg-gray-100 px-1 rounded">_mt_*</code> attrs
            moeten verschijnen.
          </li>
          <li>
            Voeg een product toe → check{' '}
            <Link
              href={`/events?store_id=${store.id}&event_name=AddToCart`}
              className="text-blue-600 hover:underline"
            >
              Events
            </Link>{' '}
            of het binnenkomt.
          </li>
          <li>
            Plaats een testorder → in{' '}
            <Link
              href={`/orders?store_id=${store.id}`}
              className="text-blue-600 hover:underline"
            >
              Orders
            </Link>{' '}
            moet de order verschijnen met{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">
              capiStatus = SUCCESS
            </code>{' '}
            en{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">
              matchSource = CART_ATTRIBUTES
            </code>
            .
          </li>
        </ol>
      </Section>
    </div>
  );
}

function Section({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-2">
        {n}. {title}
      </h2>
      {body && <p className="text-sm text-gray-600 mb-3">{body}</p>}
      {children}
    </section>
  );
}
