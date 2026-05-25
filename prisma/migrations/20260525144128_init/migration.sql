-- CreateEnum
CREATE TYPE "EventName" AS ENUM ('PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('BROWSER', 'WEBHOOK', 'SERVER');

-- CreateEnum
CREATE TYPE "CapiStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTERED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('CART_ATTRIBUTES', 'SHOPIFY_CLIENT_DETAILS', 'CUSTOMER_DATA_ONLY', 'FALLBACK_ORDER_ID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "shopifyWebhookSecretEnc" TEXT NOT NULL,
    "shopifyApiKey" TEXT,
    "shopifyApiSecretEnc" TEXT,
    "metaPixelId" TEXT NOT NULL,
    "metaAccessTokenEnc" TEXT NOT NULL,
    "metaTestEventCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fbp" TEXT,
    "fbc" TEXT,
    "fbclid" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "landingUrl" TEXT,
    "referrer" TEXT,
    "emailHash" TEXT,
    "phoneHash" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sessionId" TEXT,
    "eventId" TEXT NOT NULL,
    "eventName" "EventName" NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "source" "EventSource" NOT NULL,
    "url" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "fbclid" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "contentIds" TEXT[],
    "value" DECIMAL(12,2),
    "currency" TEXT,
    "numItems" INTEGER,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "firstNameHash" TEXT,
    "lastNameHash" TEXT,
    "cityHash" TEXT,
    "stateHash" TEXT,
    "zipHash" TEXT,
    "countryHash" TEXT,
    "rawPayload" JSONB,
    "capiForwardingSkippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "subtotalPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "firstNameHash" TEXT,
    "lastNameHash" TEXT,
    "cityHash" TEXT,
    "stateHash" TEXT,
    "zipHash" TEXT,
    "countryHash" TEXT,
    "clientIp" TEXT,
    "clientUserAgent" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "fbclid" TEXT,
    "clientId" TEXT,
    "purchaseEventId" TEXT,
    "landingUrl" TEXT,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "rawPayloadRedacted" JSONB NOT NULL,
    "capiStatus" "CapiStatus" NOT NULL DEFAULT 'PENDING',
    "capiEventIdUsed" TEXT,
    "matchSource" "MatchSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaEventLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" "EventName" NOT NULL,
    "relatedEventId" TEXT,
    "relatedOrderId" TEXT,
    "requestPayload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "eventsReceived" INTEGER,
    "fbtraceId" TEXT,
    "errorMessage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "nextRetryAt" TIMESTAMP(3),
    "deadLettered" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Store_domain_key" ON "Store"("domain");

-- CreateIndex
CREATE INDEX "Store_userId_idx" ON "Store"("userId");

-- CreateIndex
CREATE INDEX "Session_storeId_fbp_idx" ON "Session"("storeId", "fbp");

-- CreateIndex
CREATE INDEX "Session_storeId_fbc_idx" ON "Session"("storeId", "fbc");

-- CreateIndex
CREATE UNIQUE INDEX "Session_storeId_clientId_key" ON "Session"("storeId", "clientId");

-- CreateIndex
CREATE INDEX "Event_storeId_eventName_eventTime_idx" ON "Event"("storeId", "eventName", "eventTime");

-- CreateIndex
CREATE INDEX "Event_storeId_createdAt_idx" ON "Event"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_storeId_eventId_key" ON "Event"("storeId", "eventId");

-- CreateIndex
CREATE INDEX "Order_storeId_placedAt_idx" ON "Order"("storeId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_storeId_capiStatus_idx" ON "Order"("storeId", "capiStatus");

-- CreateIndex
CREATE INDEX "Order_storeId_matchSource_idx" ON "Order"("storeId", "matchSource");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_shopifyOrderId_key" ON "Order"("storeId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "MetaEventLog_storeId_sentAt_idx" ON "MetaEventLog"("storeId", "sentAt");

-- CreateIndex
CREATE INDEX "MetaEventLog_storeId_eventName_success_idx" ON "MetaEventLog"("storeId", "eventName", "success");

-- CreateIndex
CREATE INDEX "MetaEventLog_eventId_idx" ON "MetaEventLog"("eventId");

-- CreateIndex
CREATE INDEX "MetaEventLog_success_deadLettered_nextRetryAt_idx" ON "MetaEventLog"("success", "deadLettered", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaEventLog" ADD CONSTRAINT "MetaEventLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaEventLog" ADD CONSTRAINT "MetaEventLog_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaEventLog" ADD CONSTRAINT "MetaEventLog_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
