"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { getTransactions, createTransaction, getUsers } from "@/lib/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowUpCircle, ArrowDownCircle, DollarSign,
  Smartphone, CheckCircle2, XCircle, Loader2, RefreshCw,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

const TRANSACTION_TYPES = [
  { value: "DEPOSIT", label: "Deposit", icon: ArrowUpCircle, color: "text-green-600" },
  { value: "WITHDRAWAL", label: "Withdrawal", icon: ArrowDownCircle, color: "text-red-600" },
  { value: "EXPENSE", label: "Expense", icon: DollarSign, color: "text-orange-600" },
  { value: "FINE", label: "Fine", icon: DollarSign, color: "text-purple-600" },
];

type PayStep = "form" | "waiting" | "success" | "failed";

const MAX_POLLS = 12; // 12 × 3s = 36s timeout

export default function WalletPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || "MEMBER";
  const isMember = role === "MEMBER";

  const [transactions, setTransactions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Member M-Pesa state
  const [payStep, setPayStep] = useState<PayStep>("form");
  const [mpesaAmount, setMpesaAmount] = useState("");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [failMsg, setFailMsg] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Admin/Treasurer transaction form
  const [formData, setFormData] = useState({
    userId: "", amount: "", type: "DEPOSIT" as any, description: "", referenceCode: "",
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, []);

  // Pre-fill phone from session
  useEffect(() => {
    if (session?.user) {
      const phone = (session.user as any).phone || "";
      setMpesaPhone(phone);
    }
  }, [session]);

  const loadData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    const [txRes, usersRes] = await Promise.all([getTransactions(), getUsers()]);
    if (txRes.success) setTransactions(txRes.transactions || []);
    if (usersRes.success) setUsers(usersRes.users || []);
    if (!isBackground) setLoading(false);
  };

  // ── Polling logic ──────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((crid: string, amount: number) => {
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      setPollCount(count);

      try {
        const res = await fetch("/api/mpesa/stk-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkoutRequestId: crid }),
        });
        const data = await res.json();

        if (data.status === "SUCCESS") {
          stopPolling();
          setPaidAmount(data.amount || amount);
          setPayStep("success");
          loadData();
          return;
        }

        if (data.status === "FAILED") {
          stopPolling();
          setFailMsg(data.message || "Payment was cancelled or failed.");
          setPayStep("failed");
          return;
        }

        // Timed out
        if (count >= MAX_POLLS) {
          stopPolling();
          setFailMsg("No response received. If you entered your PIN, the payment may still process — check your M-Pesa messages.");
          setPayStep("failed");
        }
      } catch {
        // network blip — keep polling
      }
    }, 3000);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Initiate STK Push ──────────────────────────────────────────────────────
  const handleMpesaPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mpesaAmount || isNaN(Number(mpesaAmount)) || Number(mpesaAmount) < 1) {
      toast.error("Enter a valid amount (minimum KES 1)");
      return;
    }
    if (!mpesaPhone) {
      toast.error("Enter your M-Pesa phone number");
      return;
    }

    setPayLoading(true);
    try {
      const res = await fetch("/api/mpesa/stk-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(mpesaAmount),
          phone: mpesaPhone,
          description: "Chama Contribution",
        }),
      });
      const data = await res.json();

      if (data.success && data.checkoutRequestId) {
        setCheckoutRequestId(data.checkoutRequestId);
        setPayStep("waiting");
        startPolling(data.checkoutRequestId, Number(mpesaAmount));
      } else {
        toast.error(data.error || "Failed to send payment prompt. Try again.");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setPayLoading(false);
    }
  };

  // ── Admin manual transaction ───────────────────────────────────────────────
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createTransaction({
      userId: formData.userId,
      amount: parseFloat(formData.amount),
      type: formData.type,
      description: formData.description || undefined,
      referenceCode: formData.referenceCode || undefined,
    });
    if (result.success) {
      setDialogOpen(false);
      setFormData({ userId: "", amount: "", type: "DEPOSIT", description: "", referenceCode: "" });
      loadData();
      toast.success("Transaction recorded successfully");
    } else {
      toast.error(String(result.error) || "Failed to record transaction");
    }
  };

  const resetMpesa = () => {
    stopPolling();
    setPayStep("form");
    setCheckoutRequestId(null);
    setPollCount(0);
    setFailMsg("");
    setMpesaAmount("");
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      stopPolling();
      if (payStep === "success") loadData();
      setPayStep("form");
      setCheckoutRequestId(null);
      setPollCount(0);
      setFailMsg("");
    }
    setDialogOpen(open);
    // Pre-fill userId for member
    if (open && isMember && session?.user?.id) {
      setFormData(p => ({ ...p, userId: session.user.id, type: "DEPOSIT" }));
    }
  };

  const getTransactionIcon = (type: string) => {
    const t = TRANSACTION_TYPES.find(x => x.value === type);
    if (!t) return null;
    const Icon = t.icon;
    return <Icon className={`h-4 w-4 ${t.color}`} />;
  };

  const getTransactionColor = (type: string) => {
    if (type === "DEPOSIT" || type === "LOAN_REPAYMENT") return "text-green-600";
    if (type === "WITHDRAWAL" || type === "EXPENSE" || type === "LOAN_DISBURSEMENT") return "text-red-600";
    return "text-gray-900 dark:text-gray-100";
  };

  // ── M-Pesa Dialog Content ─────────────────────────────────────────────────
  const MpesaDialogContent = () => {
    // STEP: form
    if (payStep === "form") return (
      <form onSubmit={handleMpesaPay} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="mpesa-amount">Amount (KES)</Label>
          <Input
            id="mpesa-amount"
            type="number"
            min="1"
            step="1"
            value={mpesaAmount}
            onChange={e => setMpesaAmount(e.target.value)}
            placeholder="e.g. 1000"
            required
            className="text-lg h-12"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mpesa-phone">M-Pesa Phone Number</Label>
          <Input
            id="mpesa-phone"
            type="tel"
            value={mpesaPhone}
            onChange={e => setMpesaPhone(e.target.value)}
            placeholder="0712 345 678 or +254712345678"
            required
            className="h-12"
          />
          <p className="text-xs text-muted-foreground">
            You will receive a PIN prompt on this number.
          </p>
        </div>

        {/* Info box */}
        <div className="rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 p-4 flex gap-3">
          <Smartphone className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm text-green-800 dark:text-green-300">
            <p className="font-medium mb-0.5">How it works</p>
            <p className="text-xs opacity-80">
              After clicking "Pay with M-Pesa", you'll get a pop-up on your phone asking for your M-Pesa PIN.
              Enter your PIN to complete the contribution — no additional steps needed.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full h-12 text-base bg-green-600 hover:bg-green-700 text-white"
          disabled={payLoading}
        >
          {payLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending prompt...</>
            : <><Smartphone className="mr-2 h-5 w-5" /> Pay with M-Pesa</>
          }
        </Button>
      </form>
    );

    // STEP: waiting
    if (payStep === "waiting") return (
      <div className="flex flex-col items-center py-6 gap-6 text-center">
        {/* Animated phone */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
            <Smartphone className="h-12 w-12 text-green-600" />
          </div>
          <div className="absolute inset-0 rounded-full border-4 border-green-500 animate-ping opacity-30" />
        </div>

        <div>
          <h3 className="text-lg font-semibold text-foreground">Check your phone</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            A payment prompt has been sent to <strong>{mpesaPhone}</strong>.
            Enter your M-Pesa PIN to confirm <strong>KES {Number(mpesaAmount).toLocaleString()}</strong>.
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: MAX_POLLS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i < pollCount ? "bg-green-500" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Waiting for confirmation... ({Math.max(0, MAX_POLLS - pollCount)} checks left)
        </p>

        <Button variant="ghost" size="sm" onClick={resetMpesa} className="text-muted-foreground">
          Cancel &amp; try again
        </Button>
      </div>
    );

    // STEP: success
    if (payStep === "success") return (
      <div className="flex flex-col items-center py-6 gap-5 text-center">
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
          <CheckCircle2 className="h-14 w-14 text-green-500" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-foreground">Payment Received! 🎉</h3>
          <p className="text-muted-foreground mt-1">
            <span className="text-2xl font-bold text-green-600">
              KES {paidAmount.toLocaleString()}
            </span>
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Your contribution has been recorded.
          </p>
        </div>
        <Button
          className="w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={() => { setDialogOpen(false); resetMpesa(); }}
        >
          Done
        </Button>
      </div>
    );

    // STEP: failed
    return (
      <div className="flex flex-col items-center py-6 gap-5 text-center">
        <div className="w-24 h-24 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
          <XCircle className="h-14 w-14 text-red-500" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-foreground">Payment Failed</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">{failMsg}</p>
        </div>
        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={() => { setDialogOpen(false); resetMpesa(); }}>
            Close
          </Button>
          <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={resetMpesa}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try Again
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Wallet</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Track all transactions and savings</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button className={isMember ? "bg-green-600 hover:bg-green-700 text-white" : ""}>
              <Plus className="mr-2 h-4 w-4" />
              {isMember ? "Make Contribution" : "New Transaction"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>
                {isMember
                  ? payStep === "form" ? "Make Contribution"
                    : payStep === "waiting" ? "Awaiting Payment..."
                    : payStep === "success" ? "Payment Successful"
                    : "Payment Failed"
                  : "Record Transaction"
                }
              </DialogTitle>
              {isMember && payStep === "form" && (
                <DialogDescription>
                  Contribute to your chama wallet instantly via M-Pesa.
                </DialogDescription>
              )}
            </DialogHeader>

            {/* Member: M-Pesa multi-step */}
            {isMember && <MpesaDialogContent />}

            {/* Admin/Treasurer: manual transaction form */}
            {!isMember && (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Member</Label>
                  <Select
                    value={formData.userId}
                    onValueChange={v => setFormData({ ...formData, userId: v })}
                    required
                  >
                    <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Transaction Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v: any) => setFormData({ ...formData, type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRANSACTION_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Amount (KES)</Label>
                  <Input
                    type="number" step="0.01"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description (Optional)</Label>
                  <Input
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g. Monthly contribution"
                  />
                </div>

                <div className="space-y-2">
                  <Label>M-Pesa Code (Optional)</Label>
                  <Input
                    value={formData.referenceCode}
                    onChange={e => setFormData({ ...formData, referenceCode: e.target.value })}
                    placeholder="e.g. QGH7XYZ123"
                  />
                </div>

                <Button type="submit" className="w-full">Record Transaction</Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Transaction History
            <Button variant="ghost" size="icon" onClick={() => loadData()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading transactions...</span>
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No transactions yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Description</TableHead>
                  <TableHead className="hidden md:table-cell">Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell className="hidden md:table-cell text-xs text-gray-600 dark:text-gray-400">
                      {formatDateTime(tx.date)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{tx.user.name}</p>
                        <p className="text-[10px] text-gray-500 md:hidden">{formatDateTime(tx.date)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getTransactionIcon(tx.type)}
                        <span className="text-xs md:text-sm">{tx.type.replace(/_/g, " ")}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-gray-600 dark:text-gray-400">
                      {tx.description || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs font-mono text-gray-600 dark:text-gray-400">
                      {tx.referenceCode || "-"}
                    </TableCell>
                    <TableCell className={`text-right font-semibold text-sm ${getTransactionColor(tx.type)}`}>
                      {tx.type === "DEPOSIT" || tx.type === "LOAN_REPAYMENT" ? "+" : "-"}
                      {formatCurrency(tx.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
