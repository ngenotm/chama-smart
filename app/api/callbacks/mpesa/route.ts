/**
 * POST /api/callbacks/mpesa
 * Global M-Pesa callback endpoint.
 *
 * Safaricom calls this after STK Push completes (success or failure).
 * 
 * ── Multi-Tenant Routing ──
 * The callback JSON contains the BusinessShortCode which identifies
 * which Chama the transaction belongs to. We use this for dynamic routing.
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[M-Pesa Callback] Received:", JSON.stringify(body, null, 2));

    const stkCallback = body?.Body?.stkCallback;

    if (!stkCallback) {
      return new NextResponse("Invalid payload", { status: 400 });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = stkCallback;

    // Extract metadata items (only present on success ResultCode === 0)
    const items: any[] = CallbackMetadata?.Item || [];
    const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;

    const amount = getItem("Amount");
    const receipt = getItem("MpesaReceiptNumber"); // e.g. "QGH7XYZ123"
    const phoneRaw = getItem("PhoneNumber");

    console.log(
      "[M-Pesa Callback] CheckoutRequestID:", CheckoutRequestID,
      "ResultCode:", ResultCode,
      "MerchantRequestID:", MerchantRequestID
    );

    // ── Dynamic Chama Lookup via BusinessShortCode ──
    // The BusinessShortCode is embedded in the stkCallback at the top level
    // or can be derived from the MerchantRequestID. However, the most reliable
    // approach is to look up via the CheckoutRequestID we stored at STK push time,
    // then additionally cross-reference BusinessShortCode if needed.
    //
    // For multi-tenant identification, we also look up by the BusinessShortCode
    // in case we need to resolve which Chama this payment belongs to.

    // Find existing TransactionAlert created at STK push time
    const existingAlert = await prisma.transactionAlert.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    // If we can identify the BusinessShortCode from metadata, log it for audit
    // The BusinessShortCode is typically in the STK Push request, not the callback.
    // But we can verify by looking at the alert's user -> chama -> mpesaPaybill.
    if (existingAlert?.userId) {
      const alertUser = await prisma.user.findUnique({
        where: { id: existingAlert.userId },
        select: { chamaId: true, chama: { select: { mpesaPaybill: true, name: true } } },
      });
      if (alertUser?.chama) {
        console.log(
          `[M-Pesa Callback] Chama: "${alertUser.chama.name}" (Paybill: ${alertUser.chama.mpesaPaybill})`
        );
      }
    }

    if (ResultCode === 0) {
      // ── Success ──────────────────────────────────────────────────────────────
      if (existingAlert) {
        // Update the existing alert with the receipt and mark it for processing
        await prisma.transactionAlert.update({
          where: { checkoutRequestId: CheckoutRequestID },
          data: {
            externalId: receipt || undefined,
            amount: amount || existingAlert.amount,
            payload: body,
            status: "PENDING", // Will be set to PROCESSED by processTransactionAlert
          },
        });

        // Auto-process: match user and create transaction
        const { processTransactionAlertByCheckout } = await import("@/lib/transactions");
        await processTransactionAlertByCheckout(CheckoutRequestID);
      } else {
        // Fallback: No existing alert (shouldn't happen in normal flow).
        // Try to find the Chama by BusinessShortCode to create an alert.
        // The BusinessShortCode can be extracted from the original STK push,
        // but in the callback it's not always present. We'll create an orphan alert.
        console.warn(
          `[M-Pesa Callback] No existing alert for CheckoutRequestID: ${CheckoutRequestID}. Creating orphan.`
        );

        // Try to find a user by phone number and resolve their chama
        let resolvedUserId: string | undefined;
        if (phoneRaw) {
          const cleanPhone = phoneRaw.toString().replace("+", "").slice(-9);
          const matchedUser = await prisma.user.findFirst({
            where: { phone: { contains: cleanPhone } },
            select: { id: true },
          });
          if (matchedUser) resolvedUserId = matchedUser.id;
        }

        const alert = await prisma.transactionAlert.create({
          data: {
            externalId: receipt,
            checkoutRequestId: CheckoutRequestID,
            userId: resolvedUserId,
            provider: "MPESA",
            amount: amount || 0,
            payload: body,
            status: "PENDING",
          },
        });

        const { processTransactionAlertByCheckout } = await import("@/lib/transactions");
        await processTransactionAlertByCheckout(alert.checkoutRequestId!);
      }
    } else {
      // ── Failed / Cancelled ───────────────────────────────────────────────────
      if (existingAlert) {
        await prisma.transactionAlert.update({
          where: { checkoutRequestId: CheckoutRequestID },
          data: {
            payload: body,
            status: "FAILED",
          },
        });
      }
      console.log(`[M-Pesa Callback] Payment failed. Code: ${ResultCode} — ${ResultDesc}`);
    }

    // Always respond 200 to Safaricom to acknowledge receipt
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (error) {
    console.error("[M-Pesa Callback] Error:", error);
    // Still return 200 so Safaricom doesn't retry indefinitely
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Acknowledged" });
  }
}
