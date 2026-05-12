/**
 * POST /api/webhooks/mpesa
 * 
 * ⚠️ LEGACY ENDPOINT — kept for backward compatibility.
 * 
 * The canonical callback URL is now /api/callbacks/mpesa.
 * This route forwards any requests to the new handler so that
 * existing Daraja portal configurations continue to work.
 */

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[M-Pesa Webhook Legacy] Forwarding to /api/callbacks/mpesa");

    // Forward to the new global callback handler
    const baseUrl = process.env.MPESA_CALLBACK_URL || 
      (process.env.NEXTAUTH_URL || "http://localhost:3000");
    
    const response = await fetch(`${baseUrl}/api/callbacks/mpesa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[M-Pesa Webhook Legacy] Error forwarding:", error);
    // Still return 200 so Safaricom doesn't retry
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Acknowledged" });
  }
}
