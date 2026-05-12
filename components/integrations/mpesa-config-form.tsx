"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Copy, CheckCircle, Eye, EyeOff, ShieldCheck, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/**
 * Multi-Tenant M-Pesa Config Form
 *
 * Chama Admins only provide:
 *  - Lipa Na Mpesa Paybill/Till Number (BusinessShortCode)
 *  - Lipa Na Mpesa Passkey
 *  - Account Number prefix (optional, for Paybill)
 *  - Transaction Type (Paybill vs Buy Goods)
 *
 * Consumer Key/Secret are managed by the Platform Owner
 * and stored in server-side environment variables.
 */

const mpesaSchema = z.object({
  shortCode: z.string().min(1, "Paybill or Till number is required"),
  passkey: z.string().min(1, "LNM Passkey is required"),
  accountReference: z.string().optional(),
  transactionType: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]),
});

type MpesaFormValues = z.infer<typeof mpesaSchema>;

interface MpesaConfigFormProps {
  onSaved?: () => void;
}

export function MpesaConfigForm({ onSaved }: MpesaConfigFormProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);

  const callbackUrl =
    (typeof window !== "undefined" ? window.location.origin : "https://your-domain.com") +
    "/api/callbacks/mpesa";

  const { register, handleSubmit, reset, watch, formState: { errors } } =
    useForm<MpesaFormValues>({
      resolver: zodResolver(mpesaSchema),
      defaultValues: {
        shortCode: "",
        passkey: "",
        accountReference: "",
        transactionType: "CustomerPayBillOnline",
      },
    });

  const transactionType = watch("transactionType");

  // Load existing M-Pesa config
  useEffect(() => {
    const load = async () => {
      setFetching(true);
      try {
        const res = await fetch("/api/integrations");
        if (res.ok) {
          const data = await res.json();
          const mpesa = data.find((i: any) => i.type === "MPESA");
          if (mpesa?.isEnabled && mpesa?.config) {
            setIsConfigured(true);
            reset({
              shortCode: mpesa.config.shortCode || "",
              passkey: mpesa.config.passkey || "",
              accountReference: mpesa.config.accountReference || "",
              transactionType: mpesa.config.transactionType || "CustomerPayBillOnline",
            });
          }
        }
      } catch (e) {
        console.error("Failed to load M-Pesa config", e);
      } finally {
        setFetching(false);
      }
    };
    load();
  }, [reset]);

  const onSubmit = async (values: MpesaFormValues) => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "MPESA",
          config: values,
          name: "M-Pesa (Daraja)",
          isEnabled: true,
        }),
      });

      if (response.ok) {
        setIsConfigured(true);
        toast.success("M-Pesa payment settings saved! 🎉");
        onSaved?.();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error || "Failed to save M-Pesa settings.");
      }
    } catch {
      toast.error("An error occurred while saving.");
    } finally {
      setLoading(false);
    }
  };

  const copyCallbackUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading configuration...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Platform-managed credentials notice */}
      <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-4 flex gap-3 items-start">
        <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
            Secure Platform Integration
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5 leading-relaxed">
            API authentication (Consumer Key & Secret) is managed securely by the ChamaSmart platform.
            You only need to provide your <strong>Paybill/Till</strong> number and <strong>Passkey</strong> below.
            Your passkey is encrypted before being stored.
          </p>
        </div>
      </div>

      {/* Transaction Type */}
      <div className="space-y-2">
        <Label>Payment Method</Label>
        <div className="flex gap-3">
          {([
            { value: "CustomerPayBillOnline", label: "Paybill" },
            { value: "CustomerBuyGoodsOnline", label: "Till (Buy Goods)" },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border cursor-pointer text-sm font-medium transition-colors ${
                transactionType === opt.value
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  : "border-muted text-muted-foreground hover:border-foreground/30"
              }`}
            >
              <input type="radio" value={opt.value} {...register("transactionType")} className="sr-only" />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Shortcode (Paybill / Till) */}
      <div className="space-y-2">
        <Label htmlFor="shortCode">
          {transactionType === "CustomerPayBillOnline" ? "Lipa Na Mpesa Paybill Number" : "Till Number"}
        </Label>
        <Input
          id="shortCode"
          {...register("shortCode")}
          placeholder={transactionType === "CustomerPayBillOnline" ? "e.g. 522522" : "e.g. 123456"}
        />
        {errors.shortCode && <p className="text-xs text-red-500">{errors.shortCode.message}</p>}
        <p className="text-xs text-muted-foreground">
          This is your M-Pesa receiving number (BusinessShortCode) provided by Safaricom.
        </p>
      </div>

      {/* Account Reference (Paybill only) */}
      {transactionType === "CustomerPayBillOnline" && (
        <div className="space-y-2">
          <Label htmlFor="accountReference">Account Number / Reference</Label>
          <Input
            id="accountReference"
            {...register("accountReference")}
            placeholder="e.g. 0123456789 (your chama's bank account number)"
          />
          <p className="text-xs text-muted-foreground">
            This appears on the member's M-Pesa receipt as the account number.
          </p>
        </div>
      )}

      <Separator />

      {/* LNM Passkey */}
      <div className="space-y-2">
        <Label htmlFor="passkey">Lipa Na Mpesa Online Passkey</Label>
        <div className="relative">
          <Input
            id="passkey"
            type={showPasskey ? "text" : "password"}
            {...register("passkey")}
            placeholder="Lipa Na M-Pesa Online Passkey from Safaricom"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPasskey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPasskey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.passkey && <p className="text-xs text-red-500">{errors.passkey.message}</p>}
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Obtain this from your Safaricom Daraja portal or your bank relationship manager.
            It's encrypted before being stored in our database.
          </span>
        </p>
      </div>

      <Separator />

      {/* Callback URL to paste in Daraja */}
      <div className="space-y-2">
        <Label>Callback URL <Badge variant="secondary" className="ml-1 text-xs">Auto-managed</Badge></Label>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={callbackUrl}
            className="font-mono text-xs bg-muted"
          />
          <Button type="button" variant="outline" size="icon" onClick={copyCallbackUrl}>
            {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This global callback URL is auto-configured. All M-Pesa payment results are routed here.
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isConfigured ? "Update M-Pesa Settings" : "Save M-Pesa Settings"}
      </Button>
    </form>
  );
}
