/**
 * lib/mpesa.ts
 * Daraja API helpers for M-Pesa STK Push integration.
 *
 * ── Multi-Tenant "Master App" Architecture ──
 * • OAuth token is generated using the PLATFORM OWNER's master credentials
 *   (MPESA_MASTER_CONSUMER_KEY / MPESA_MASTER_CONSUMER_SECRET env vars).
 * • Each Chama provides its own Paybill/Till + Passkey (stored encrypted in DB).
 * • STK Push uses the Chama's Paybill + Passkey, authorized by the Master Token.
 * • A single global callback URL handles all Chamas.
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

function getBaseUrl(): string {
  return process.env.MPESA_ENV === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-Chama M-Pesa config (fetched from DB, passkey decrypted at runtime) */
export interface ChamaMpesaConfig {
  shortCode: string;        // Paybill or Till number (BusinessShortCode)
  passkey: string;          // Decrypted LNM Passkey
  accountReference?: string;
  transactionType?: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
}

export interface StkPushParams {
  chamaConfig: ChamaMpesaConfig;
  phone: string;            // Member's phone: 2547XXXXXXXX
  amount: number;           // Amount in KES (whole number)
  description?: string;
  callbackUrl: string;
}

export interface StkPushResult {
  success: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  error?: string;
  rawResponse?: any;
}

export interface StkStatusResult {
  success: boolean;
  status: "PENDING" | "SUCCESS" | "FAILED";
  resultCode?: number;
  resultDesc?: string;
  error?: string;
}

// ─── Phone Validation ─────────────────────────────────────────────────────────

/**
 * Validate that a phone number matches the required 2547XXXXXXXX format.
 */
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  const cleaned = normalisePhone(phone);
  if (!/^2547\d{8}$/.test(cleaned)) {
    return {
      valid: false,
      error: "Phone number must be in the format 2547XXXXXXXX (e.g. 254712345678).",
    };
  }
  return { valid: true };
}

/**
 * Normalise phone to 254XXXXXXXXX format
 */
export function normalisePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) return "254" + cleaned.slice(1);
  if (cleaned.startsWith("254")) return cleaned;
  if (cleaned.startsWith("+254")) return cleaned.slice(1);
  return cleaned;
}

// ─── OAuth Token (Master Credentials) ─────────────────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get an OAuth token using the Platform Owner's master credentials.
 * These NEVER leave the server — stored in MPESA_MASTER_CONSUMER_KEY / MPESA_MASTER_CONSUMER_SECRET.
 */
export async function getMasterToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const consumerKey = process.env.MPESA_MASTER_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_MASTER_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "MPESA_MASTER_CONSUMER_KEY and MPESA_MASTER_CONSUMER_SECRET must be set in environment variables."
    );
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const base = getBaseUrl();

  const response = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get M-Pesa master token: ${response.status} — ${text}`);
  }

  const data = await response.json();
  const expiresIn = parseInt(data.expires_in || "3600", 10) * 1000;

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn,
  };

  return data.access_token;
}

// ─── STK Push ─────────────────────────────────────────────────────────────────

/**
 * Generate the Lipa Na M-Pesa password (Base64 of shortcode + passkey + timestamp)
 */
function generatePassword(shortCode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");
}

/**
 * Format timestamp as YYYYMMDDHHmmss
 */
function getTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
}

/**
 * Initiate STK Push — sends a payment prompt to the member's phone.
 * Uses the MASTER token for authorization, but the CHAMA's Paybill + Passkey for the payload.
 */
export async function initiateStkPush(params: StkPushParams): Promise<StkPushResult> {
  try {
    const { chamaConfig, phone, amount, description, callbackUrl } = params;

    // 1. Get master OAuth token
    const token = await getMasterToken();

    // 2. Build payload using the Chama's credentials
    const timestamp = getTimestamp();
    const password = generatePassword(chamaConfig.shortCode, chamaConfig.passkey, timestamp);
    const normalised = normalisePhone(phone);
    const base = getBaseUrl();

    const transactionType = chamaConfig.transactionType || "CustomerPayBillOnline";
    const accountRef = chamaConfig.accountReference || chamaConfig.shortCode;

    const payload = {
      BusinessShortCode: chamaConfig.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: Math.ceil(amount), // M-Pesa requires whole numbers
      PartyA: normalised,         // Customer phone
      PartyB: chamaConfig.shortCode, // Receiving shortcode
      PhoneNumber: normalised,    // Phone to receive the STK prompt
      CallBackURL: callbackUrl,
      AccountReference: accountRef,
      TransactionDesc: description || "Chama Contribution",
    };

    console.log("[MPesa STK Push] Initiating:", {
      phone: normalised,
      amount: Math.ceil(amount),
      shortCode: chamaConfig.shortCode,
      transactionType,
      authMode: "MASTER_TOKEN",
    });

    const response = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("[MPesa STK Push] Response:", data);

    if (data.ResponseCode === "0") {
      return {
        success: true,
        checkoutRequestId: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID,
        rawResponse: data,
      };
    }

    return {
      success: false,
      error: data.ResponseDescription || data.errorMessage || "STK Push failed",
      rawResponse: data,
    };
  } catch (error: any) {
    console.error("[MPesa STK Push] Error:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

// ─── STK Status Query ─────────────────────────────────────────────────────────

/**
 * Query the status of a pending STK Push transaction.
 * Uses MASTER token for authorization, Chama's Paybill + Passkey for the payload.
 */
export async function queryStkStatus(
  checkoutRequestId: string,
  chamaConfig: ChamaMpesaConfig
): Promise<StkStatusResult> {
  try {
    const token = await getMasterToken();
    const timestamp = getTimestamp();
    const password = generatePassword(chamaConfig.shortCode, chamaConfig.passkey, timestamp);
    const base = getBaseUrl();

    const payload = {
      BusinessShortCode: chamaConfig.shortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const response = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("[MPesa STK Status]", checkoutRequestId, "→", data);

    // ResultCode 0 = success, 1032 = cancelled/pending, others = failed
    if (data.ResultCode === "0" || data.ResultCode === 0) {
      return { success: true, status: "SUCCESS", resultCode: 0, resultDesc: data.ResultDesc };
    }

    if (data.errorCode === "500.001.1001" || !data.ResultCode) {
      // Still processing / not yet complete
      return { success: true, status: "PENDING", resultDesc: "Processing" };
    }

    return {
      success: true,
      status: "FAILED",
      resultCode: data.ResultCode,
      resultDesc: data.ResultDesc || "Payment failed or cancelled",
    };
  } catch (error: any) {
    console.error("[MPesa STK Status] Error:", error);
    return { success: false, status: "FAILED", error: error.message };
  }
}

// ─── Config Loader ────────────────────────────────────────────────────────────

/**
 * Fetch a Chama's M-Pesa config from the Chama model (not Integration table).
 * Decrypts the passkey at runtime.
 */
export async function getChamaMpesaConfig(
  chamaId: string
): Promise<ChamaMpesaConfig | null> {
  try {
    const chama = await prisma.chama.findUnique({
      where: { id: chamaId },
      select: {
        mpesaPaybill: true,
        mpesaPasskey: true,
        mpesaAccountRef: true,
        mpesaTransactionType: true,
      },
    });

    if (!chama?.mpesaPaybill || !chama?.mpesaPasskey) {
      return null;
    }

    // Decrypt the passkey
    let decryptedPasskey: string;
    try {
      decryptedPasskey = decrypt(chama.mpesaPasskey);
    } catch (err) {
      console.error("[getChamaMpesaConfig] Failed to decrypt passkey:", err);
      return null;
    }

    return {
      shortCode: chama.mpesaPaybill,
      passkey: decryptedPasskey,
      accountReference: chama.mpesaAccountRef || undefined,
      transactionType: (chama.mpesaTransactionType as ChamaMpesaConfig["transactionType"]) || undefined,
    };
  } catch (error) {
    console.error("[getChamaMpesaConfig] Error:", error);
    return null;
  }
}

/**
 * @deprecated Use getChamaMpesaConfig instead. Kept for backward compatibility.
 * Legacy config loader that reads from Integration table — now redirects to Chama model.
 */
export async function getMpesaIntegrationConfig(
  chamaId: string
): Promise<{ config: ChamaMpesaConfig; integrationId: string } | null> {
  const config = await getChamaMpesaConfig(chamaId);
  if (!config) return null;
  return { config, integrationId: "chama-model" };
}
