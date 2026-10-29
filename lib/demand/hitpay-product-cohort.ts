import { createHash } from "node:crypto";

/**
 * DEMAND-only historical HitPay cohort cross-read. The top-products report,
 * order inventory and sales summary are independent aggregate observations;
 * matching date/amount/count NEVER proves the purchased line item of an
 * individual order, Meta attribution, settlement or entitlement.
 * Connector reads do not authenticate a DEMAND app-owned tenant session.
 */
type Order = Readonly<{
  id: string; order_display_number: number; channel: string;
  amount: number; currency: string; status: string;
  payment_status: string; created_at: string;
}>;
type OrderPage = Readonly<{
  data: readonly Order[]; has_more: boolean; next_cursor: string | null;
}>;
type Product = Readonly<{
  product_id: string; product_name: string; sold: number;
  gross_sales: number; currency: string;
}>;
type Summary = Readonly<{
  currency: string; payments: number; gross_sales: number;
  refunds: number; total_fees: number; net_collected: number;
}>;
export type DemandHitPayProductCohortInput = Readonly<{
  dayMyt: string;
  expectedProductId: string;
  expectedHistoricalProductName: string;
  orders: OrderPage;
  topProducts: readonly Product[]; // Top-N results; NOT a complete catalog.
  salesSummary: Summary;
  productsQueryChannel: "store_checkout";
  summaryQueryChannel: "api_store";
}>;
const fail = (): never => { throw new Error("Invalid DEMAND HitPay product cohort"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const day = (d: unknown): d is string => typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) &&
  new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const mytDay = (date: string): string =>
  new Date(Date.parse(date) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function assessDemandHitPayProductCohort(input: DemandHitPayProductCohortInput) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !day(input.dayMyt) || typeof input.expectedProductId !== "string" ||
      !UUID.test(input.expectedProductId) ||
      typeof input.expectedHistoricalProductName !== "string" ||
      input.expectedHistoricalProductName.length < 3 ||
      input.expectedHistoricalProductName.length > 160 ||
      input.productsQueryChannel !== "store_checkout" ||
      input.summaryQueryChannel !== "api_store" ||
      !input.orders || !Array.isArray(input.orders.data) ||
      input.orders.data.length !== 1 || input.orders.has_more !== false ||
      input.orders.next_cursor !== null ||
      !Array.isArray(input.topProducts) || input.topProducts.length > 20 ||
      !input.salesSummary) fail();
  const order = input.orders.data[0];
  if (!order || typeof order.id !== "string" || !UUID.test(order.id) ||
      !Number.isSafeInteger(order.order_display_number) || order.order_display_number < 1 ||
      order.channel !== "store_checkout" || typeof order.currency !== "string" ||
      order.currency.toLowerCase() !== "myr" ||
      order.status !== "completed" || order.payment_status !== "paid" ||
      !money(order.amount) || typeof order.created_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(order.created_at) ||
      !Number.isFinite(Date.parse(order.created_at)) ||
      new Date(Date.parse(order.created_at)).toISOString().slice(0, 19) !==
        order.created_at.slice(0, 19) ||
      mytDay(order.created_at) !== input.dayMyt) fail();
  const summary = input.salesSummary;
  if (typeof summary.currency !== "string" || summary.currency.toLowerCase() !== "myr" ||
      !money(summary.payments) || !money(summary.gross_sales) ||
      !money(summary.refunds) || !money(summary.total_fees) ||
      !money(summary.net_collected)) fail();
  const products = new Map<string, Product>();
  for (const product of input.topProducts) {
    if (!product || typeof product.product_id !== "string" ||
        !UUID.test(product.product_id) || products.has(product.product_id.toLowerCase()) ||
        typeof product.product_name !== "string" ||
        product.product_name.length < 1 || product.product_name.length > 160 ||
        typeof product.currency !== "string" || product.currency.toLowerCase() !== "myr" ||
        !money(product.sold) || !money(product.gross_sales)) fail();
    products.set(product.product_id.toLowerCase(), product);
  }
  const observed = products.get(input.expectedProductId.toLowerCase()) ?? null;
  const productNameMatches = observed?.product_name === input.expectedHistoricalProductName;
  const aggregateAligned = productNameMatches && observed !== null &&
    observed.sold === 1 && observed.gross_sales === order.amount &&
    summary.payments === 1 && summary.gross_sales === order.amount &&
    summary.refunds === 0 && summary.total_fees <= summary.gross_sales &&
    summary.net_collected === summary.gross_sales - summary.total_fees;
  const status = observed === null ? "PRODUCT_NOT_IN_TOP_RESULTS_UNREAD" as const :
    aggregateAligned ? "COHORT_TOTALS_ALIGN_UNATTESTED" as const :
      "COHORT_TOTALS_REQUIRE_REVIEW" as const;
  // Fingerprint material cohort revisions without exposing raw merchant IDs.
  const orderIdentityDigest = createHash("sha256")
    .update("bros-demand:hitpay-order-identity:v1:" + order.id.toLowerCase()).digest("hex");
  const snapshotKey = "demand:hitpay-product-cohort:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", input.dayMyt, input.productsQueryChannel,
      input.summaryQueryChannel, input.expectedProductId.toLowerCase(),
      input.expectedHistoricalProductName, orderIdentityDigest,
      order.order_display_number, order.amount, order.status, order.payment_status,
      [...products.values()].map(p => [p.product_id.toLowerCase(), p.product_name,
        p.sold, p.gross_sales]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      summary.currency.toLowerCase(), summary.payments, summary.gross_sales,
      summary.refunds, summary.total_fees, summary.net_collected]))
    .digest("hex");
  return Object.freeze({
    snapshotKey, orderIdentityDigest, status,
    historicalOrderNumber: order.order_display_number,
    productCode: "BROS_SELL_CORE" as const,
    observedProductUnits: observed?.sold ?? null,
    observedProductGrossMinor: observed?.gross_sales ?? null,
    orderGrossMinor: order.amount,
    observedSummaryPayments: summary.payments,
    observedSummaryGrossMinor: summary.gross_sales,
    observedSummaryNetCollectedMinor: summary.net_collected,
    // Top-N product coverage and sales-summary channel equivalence are NOT
    // attested by the provider's returned data. Neither is a line-item join.
    topProductListCompleteVerified: false as const,
    channelScopeEquivalenceVerified: false as const,
    directOrderLineItemJoinVerified: false as const,
    providerAuthenticationVerifiedForDemandApp: false as const,
    tenantAuthorizationVerifiedForDemandApp: false as const,
    paymentEnvironmentVerified: false as const,
    payoutAllocationVerified: false as const,
    bankSettlementVerified: false as const,
    entitlementVerified: false as const,
    metaEventToOrderJoinVerified: false as const,
    verifiedAcquisitionOutcome: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    durableBciLearningVerified: false as const,
    nextEvidenceAction: "OBTAIN_ORDER_LINE_ITEM_AND_META_EVENT_IDENTITY_RECEIPTS" as const,
  });
}
