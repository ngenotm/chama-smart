"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { MpesaConfigForm } from "./mpesa-config-form";
import { PaystackConfigForm } from "./paystack-config-form";
import { BankConfigForm } from "./bank-config-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface IntegrationCardProps {
  title: string;
  description: string;
  type: "MPESA" | "PAYSTACK" | "BANK";
  icon: React.ReactNode;
}

export function IntegrationCard({ title, description, type, icon }: IntegrationCardProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations");
      if (res.ok) {
        const data = await res.json();
        // Map "BANK" type to KCB or EQUITY in DB
        const match = data.find(
          (i: any) =>
            i.type === type ||
            (type === "BANK" && (i.type === "KCB" || i.type === "EQUITY"))
        );
        setIsConnected(!!(match && match.isEnabled));
      }
    } catch {
      // leave as not connected
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleSaved = () => {
    setOpen(false);
    checkStatus(); // Refresh badge
  };

  return (
    <Card className="flex flex-col border-border/60 hover:border-border transition-colors">
      <CardHeader className="flex flex-row items-center gap-4 space-y-0">
        <div className="bg-muted p-2.5 rounded-xl">{icon}</div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-2 mt-1.5">
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : isConnected ? (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800 text-xs">
                ● Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Not Connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pt-2">
        <CardDescription className="flex-1 text-sm leading-relaxed">
          {description}
        </CardDescription>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant={isConnected ? "outline" : "default"}
              className="w-full mt-4"
              disabled={loading}
            >
              {isConnected ? "⚙️ Reconfigure" : "Connect Now"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isConnected ? "Reconfigure" : "Connect"} {title}
              </DialogTitle>
              <DialogDescription>
                {type === "MPESA"
                  ? "Enter your Lipa Na Mpesa Paybill/Till number and Passkey. API authentication is handled securely by the platform."
                  : `Provide your API credentials and settings for ${title}.`}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              {type === "MPESA" && <MpesaConfigForm onSaved={handleSaved} />}
              {type === "PAYSTACK" && <PaystackConfigForm />}
              {type === "BANK" && <BankConfigForm />}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
