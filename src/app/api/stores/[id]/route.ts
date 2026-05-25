/**
 * PATCH  /api/stores/:id — update store settings
 * DELETE /api/stores/:id — soft-delete (sets active=false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

const UpdateStoreSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domain: z.string().min(3).max(255).optional(),
  currency: z.string().length(3).optional(),
  shopify_webhook_secret: z.string().min(8).optional(),
  meta_pixel_id: z.string().min(5).optional(),
  meta_access_token: z.string().min(20).optional(),
  meta_test_event_code: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

async function getUserId(): Promise<string | undefined> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateStoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', details: parsed.error.format() },
      { status: 400 }
    );
  }

  const existing = await prisma.store.findFirst({
    where: { id: params.id, userId },
  });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const d = parsed.data;
  const updated = await prisma.store.update({
    where: { id: existing.id },
    data: {
      name: d.name ?? undefined,
      domain: d.domain ?? undefined,
      currency: d.currency ?? undefined,
      metaPixelId: d.meta_pixel_id ?? undefined,
      metaTestEventCode:
        d.meta_test_event_code === undefined ? undefined : d.meta_test_event_code,
      active: d.active ?? undefined,
      shopifyWebhookSecretEnc: d.shopify_webhook_secret
        ? encrypt(d.shopify_webhook_secret)
        : undefined,
      metaAccessTokenEnc: d.meta_access_token
        ? encrypt(d.meta_access_token)
        : undefined,
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
  return NextResponse.json({ store: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const existing = await prisma.store.findFirst({
    where: { id: params.id, userId },
  });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.store.update({
    where: { id: existing.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
}
