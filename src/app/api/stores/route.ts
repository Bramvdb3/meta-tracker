/**
 * GET  /api/stores       — list stores for the logged-in user
 * POST /api/stores       — create a new store; encrypts secret + access token
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

const CreateStoreSchema = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().min(3).max(255),
  currency: z.string().length(3).default('EUR'),
  shopify_webhook_secret: z.string().min(8),
  meta_pixel_id: z.string().min(5),
  meta_access_token: z.string().min(20),
  meta_test_event_code: z.string().optional(),
});

async function getUserId(): Promise<string | undefined> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const stores = await prisma.store.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      domain: true,
      currency: true,
      metaPixelId: true,
      metaTestEventCode: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ stores });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateStoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', details: parsed.error.format() },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const store = await prisma.store.create({
    data: {
      userId,
      name: d.name,
      domain: d.domain,
      currency: d.currency,
      shopifyWebhookSecretEnc: encrypt(d.shopify_webhook_secret),
      metaPixelId: d.meta_pixel_id,
      metaAccessTokenEnc: encrypt(d.meta_access_token),
      metaTestEventCode: d.meta_test_event_code ?? null,
    },
    select: {
      id: true,
      name: true,
      domain: true,
      currency: true,
      metaPixelId: true,
      active: true,
    },
  });
  return NextResponse.json({ store }, { status: 201 });
}
