/**
 * /api/integrations
 * GET  — Fetch all integrations for the current chama + M-Pesa config from Chama model
 * POST — Save/update integration config. For M-Pesa, writes to Chama model with encryption.
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";

export async function GET() {
  const session = await auth();

  if (!session?.user || session.user.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const chamaId = (session.user as any).chamaId;
  if (!chamaId) {
    return new NextResponse("Chama not found", { status: 404 });
  }

  // Fetch generic integrations
  const integrations = await prisma.integration.findMany({
    where: { chamaId },
  });

  // Also fetch M-Pesa config from the Chama model itself
  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    select: {
      mpesaPaybill: true,
      mpesaPasskey: true,
      mpesaAccountRef: true,
      mpesaTransactionType: true,
    },
  });

  // Build a virtual "MPESA" integration entry from the Chama model
  // so the frontend can detect if M-Pesa is configured
  const mpesaConfigured = !!(chama?.mpesaPaybill && chama?.mpesaPasskey);

  const mpesaVirtual = {
    id: "__mpesa_chama__",
    type: "MPESA",
    name: "M-Pesa (Daraja)",
    isEnabled: mpesaConfigured,
    config: mpesaConfigured
      ? {
          shortCode: chama!.mpesaPaybill,
          // Don't send the encrypted passkey to the client — just indicate it's set
          passkey: "••••••••",
          accountReference: chama!.mpesaAccountRef || "",
          transactionType: chama!.mpesaTransactionType || "CustomerPayBillOnline",
        }
      : null,
  };

  // Replace any legacy MPESA integration with the virtual one
  const filtered = integrations.filter((i) => i.type !== "MPESA");

  return NextResponse.json([mpesaVirtual, ...filtered]);
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user || session.user.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const chamaId = (session.user as any).chamaId;
  if (!chamaId) {
    return new NextResponse("Chama not found", { status: 404 });
  }

  const body = await req.json();
  const { type, config, name, isEnabled, id } = body;

  // ── M-Pesa: Write to Chama model with encryption ──
  if (type === "MPESA") {
    const { shortCode, passkey, accountReference, transactionType } = config || {};

    if (!shortCode || !passkey) {
      return NextResponse.json(
        { error: "Paybill/Till number and Passkey are required." },
        { status: 400 }
      );
    }

    // Encrypt the passkey before storing
    // If passkey is the masked placeholder, don't re-encrypt — keep existing
    let encryptedPasskey: string;
    if (passkey === "••••••••") {
      // User didn't change the passkey — keep existing
      const existing = await prisma.chama.findUnique({
        where: { id: chamaId },
        select: { mpesaPasskey: true },
      });
      if (!existing?.mpesaPasskey) {
        return NextResponse.json(
          { error: "Passkey is required. Please enter your LNM Passkey." },
          { status: 400 }
        );
      }
      encryptedPasskey = existing.mpesaPasskey;
    } else {
      encryptedPasskey = encrypt(passkey);
    }

    const updated = await prisma.chama.update({
      where: { id: chamaId },
      data: {
        mpesaPaybill: shortCode,
        mpesaPasskey: encryptedPasskey,
        mpesaAccountRef: accountReference || null,
        mpesaTransactionType: transactionType || "CustomerPayBillOnline",
      },
    });

    return NextResponse.json({
      id: "__mpesa_chama__",
      type: "MPESA",
      name: "M-Pesa (Daraja)",
      isEnabled: true,
      config: {
        shortCode: updated.mpesaPaybill,
        passkey: "••••••••",
        accountReference: updated.mpesaAccountRef || "",
        transactionType: updated.mpesaTransactionType || "CustomerPayBillOnline",
      },
    });
  }

  // ── Other integrations: store in Integration table as before ──
  if (id) {
    // Update existing
    const integration = await prisma.integration.update({
      where: { id },
      data: {
        type,
        config: config || {},
        name,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
      },
    });
    return NextResponse.json(integration);
  } else {
    // Create new
    const integration = await prisma.integration.create({
      data: {
        type,
        config: config || {},
        name,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        chamaId,
      },
    });
    return NextResponse.json(integration);
  }
}
