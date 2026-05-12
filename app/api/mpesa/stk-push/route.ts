/**
 * POST /api/mpesa/stk-push
 * Initiates a Safaricom M-Pesa STK Push for the authenticated member.
 * 
 * ── Multi-Tenant Flow ──
 * 1. Fetches the Chama's Paybill + Passkey from DB (decrypted at runtime)
 * 2. Gets OAuth token using MASTER credentials (env vars)
 * 3. Sends STK Push with Chama's Paybill + Passkey, authorized by Master Token
 * 4. Returns checkoutRequestId for frontend polling
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initiateStkPush, normalisePhone, validatePhone, getChamaMpesaConfig } from "@/lib/mpesa";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { amount, phone, description } = await req.json();

    if (!amount || isNaN(Number(amount)) || Number(amount) < 1) {
      return NextResponse.json({ error: "Invalid amount. Minimum is KES 1." }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    }

    // Server-side phone validation: must be 2547XXXXXXXX
    const normalised = normalisePhone(phone);
    const phoneCheck = validatePhone(normalised);
    if (!phoneCheck.valid) {
      return NextResponse.json({ error: phoneCheck.error }, { status: 400 });
    }

    // Get the user's chama
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { chamaId: true, name: true },
    });

    if (!user?.chamaId) {
      return NextResponse.json({ error: "User has no chama context." }, { status: 400 });
    }

    // Load the chama's M-Pesa configuration (Paybill + decrypted Passkey)
    const chamaConfig = await getChamaMpesaConfig(user.chamaId);
    if (!chamaConfig) {
      return NextResponse.json(
        {
          error:
            "M-Pesa is not configured for this chama. Ask your admin to set up M-Pesa in Settings → Integrations.",
        },
        { status: 400 }
      );
    }

    const callbackUrl =
      (process.env.MPESA_CALLBACK_URL || "https://your-domain.com") +
      "/api/callbacks/mpesa";

    const result = await initiateStkPush({
      chamaConfig,
      phone: normalised,
      amount: Number(amount),
      description: description || "Chama Contribution",
      callbackUrl,
    });

    if (!result.success || !result.checkoutRequestId) {
      return NextResponse.json(
        { error: result.error || "Failed to initiate payment. Please try again." },
        { status: 502 }
      );
    }

    // Create a TransactionAlert record with the checkoutRequestId so we can
    // match the callback AND support polling without callback in dev.
    await prisma.transactionAlert.create({
      data: {
        checkoutRequestId: result.checkoutRequestId,
        userId: session.user.id,
        provider: "MPESA",
        amount: Number(amount),
        payload: { merchantRequestId: result.merchantRequestId },
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      checkoutRequestId: result.checkoutRequestId,
      message: "Payment prompt sent to your phone. Enter your M-Pesa PIN to complete.",
    });
  } catch (error: any) {
    console.error("[STK Push Route] Error:", error);
    return NextResponse.json(
      { error: "Internal server error. Please try again." },
      { status: 500 }
    );
  }
}
