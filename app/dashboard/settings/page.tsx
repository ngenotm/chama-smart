"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { updateUser, getChamaDetails, updateChama } from "@/lib/actions";
import { User as UserIcon, Smartphone, CreditCard, Landmark } from "lucide-react";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { UploadButton } from "@/lib/uploadthing";
import { toTitleCase, formatKenyanPhone, getPhoneValidationError, getNameValidationError } from "@/lib/utils";

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [profilePicture, setProfilePicture] = useState<string | null>(null);

  // User Profile State
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });

  // Chama Settings State
  const [chamaSettings, setChamaSettings] = useState({
    id: "",
    name: "",
    email: "",
    phone: "",
    logo: "",
  });

  const [chamaLogoPreview, setChamaLogoPreview] = useState<string | null>(null);

  // Initialize profile state from session
  useEffect(() => {
    if (session?.user) {
      setProfile({
        name: session.user.name || "",
        email: session.user.email || "",
        phone: (session.user as any).phone || "",
        password: "",
      });
      setProfilePicture((session.user as any).avatarUrl || null);
    }
  }, [session]);

  // Load Chama Detail for Admin
  useEffect(() => {
    if (isAdmin) {
      const loadChama = async () => {
        const result = await getChamaDetails();
        if (result.success && result.chama) {
          setChamaSettings(prev => ({
            ...prev,
            id: result.chama!.id,
            name: result.chama!.name,
            email: result.chama!.email,
            phone: result.chama!.phone || "",
            logo: result.chama!.logo || "",
          }));
          setChamaLogoPreview(result.chama!.logo || null);
        }
      };
      loadChama();
    }
  }, [isAdmin]);

  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const handleNameBlur = () => {
    const error = getNameValidationError(profile.name);
    setNameError(error);
    if (!error && profile.name) {
      setProfile(prev => ({ ...prev, name: toTitleCase(prev.name) }));
    }
  };

  const handlePhoneBlur = () => {
    const error = getPhoneValidationError(profile.phone);
    setPhoneError(error);
    if (!error && profile.phone) {
      setProfile(prev => ({ ...prev, phone: formatKenyanPhone(prev.phone) }));
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!session?.user?.id) {
      toast.error("Session not found");
      setLoading(false);
      return;
    }

    const nameErr = getNameValidationError(profile.name);
    const phoneErr = getPhoneValidationError(profile.phone);
    if (nameErr) {
      setNameError(nameErr);
      setLoading(false);
      return;
    }
    if (phoneErr) {
      setPhoneError(phoneErr);
      setLoading(false);
      return;
    }

    const formattedName = toTitleCase(profile.name);
    const formattedPhone = profile.phone ? formatKenyanPhone(profile.phone) : "";

    const result = await updateUser(session.user.id, {
      name: formattedName,
      email: profile.email,
      phone: formattedPhone,
      password: profile.password || undefined,
      role: session.user.role as any,
      avatarUrl: profilePicture || undefined,
    });

    if (result.success) {
      toast.success("Profile updated successfully");
      setProfile({ 
        ...profile, 
        name: formattedName,
        phone: formattedPhone,
        password: "" 
      });
      
      // Update the active session so the UI (sidebar/header) updates immediately
      await update({
        user: {
          ...session?.user,
          name: formattedName,
          email: profile.email,
          phone: formattedPhone,
          avatarUrl: profilePicture,
        }
      });
    } else {
      toast.error(String(result.error));
    }
    setLoading(false);
  };

  const handleChamaUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chamaSettings.id) return;
    
    setLoading(true);
    const result = await updateChama(chamaSettings.id, {
      name: chamaSettings.name,
      phone: chamaSettings.phone,
      logo: chamaLogoPreview || undefined,
    });

    if (result.success) {
      toast.success("Chama branding updated successfully");
      await update({
        user: {
          ...session?.user,
          chamaName: chamaSettings.name,
          chamaLogo: chamaLogoPreview,
        }
      });
    } else {
      toast.error(String(result.error));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Manage your account and preferences</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {isAdmin && <TabsTrigger value="chama">Chama Settings</TabsTrigger>}
          {isAdmin && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details and password</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label>Profile Picture</Label>
                  <div className="flex items-center gap-4">
                    <div className="h-20 w-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white overflow-hidden">
                      {profilePicture ? (
                        <img src={profilePicture} alt="Profile" className="h-full w-full object-cover" />
                      ) : (
                        <UserIcon className="h-10 w-10" />
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-1.5">
                      <UploadButton
                        endpoint="profilePicture"
                        onClientUploadComplete={(res) => {
                          setProfilePicture(res[0].url);
                          toast.success("Profile picture uploaded!");
                        }}
                        onUploadError={(error: Error) => {
                          toast.error(`Upload failed: ${error.message}`);
                        }}
                        content={{
                          allowedContent: null
                        }}
                        appearance={{
                          button: "bg-blue-600 hover:bg-blue-700 text-sm h-9 px-4 transition-all duration-200 active:scale-95",
                          container: "w-max",
                        }}
                      />
                      <p className="text-[11px] font-medium text-muted-foreground">Max 4MB (JPG, PNG)</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input 
                    id="name" 
                    value={profile.name}
                    onChange={(e) => {
                      setProfile({...profile, name: e.target.value});
                      if (nameError) setNameError(null);
                    }}
                    onBlur={handleNameBlur}
                    className={nameError ? "border-red-500" : ""}
                  />
                  {nameError && (
                    <p className="text-[11px] text-red-600">{nameError}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({...profile, email: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input 
                    id="phone" 
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => {
                      setProfile({...profile, phone: e.target.value});
                      if (phoneError) phoneError && setPhoneError(null);
                    }}
                    onBlur={handlePhoneBlur}
                    placeholder="+254..."
                    className={phoneError ? "border-red-500" : ""}
                  />
                  {phoneError && (
                    <p className="text-[11px] text-red-600">{phoneError}</p>
                  )}
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <Label htmlFor="password">New Password (Optional)</Label>
                  <Input 
                    id="password" 
                    type="password"
                    value={profile.password}
                    onChange={(e) => setProfile({...profile, password: e.target.value})}
                    placeholder="Leave blank to keep current"
                  />
                </div>

                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="chama" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Chama Configuration</CardTitle>
                <CardDescription>General settings and branding for your group</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChamaUpdate} className="space-y-4 max-w-lg">
                  <div className="space-y-2">
                    <Label>Group Logo</Label>
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-20 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl overflow-hidden shadow-md">
                        {chamaLogoPreview ? (
                          <img src={chamaLogoPreview} alt="Group Logo" className="h-full w-full object-cover" />
                        ) : (
                          chamaSettings.name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "CS"
                        )}
                      </div>
                      <div className="flex flex-col items-start gap-1.5">
                        <UploadButton
                          endpoint="chamaLogo"
                          onClientUploadComplete={(res) => {
                            setChamaLogoPreview(res[0].url);
                            toast.success("Chama logo uploaded!");
                          }}
                          onUploadError={(error: Error) => {
                            toast.error(`Upload failed: ${error.message}`);
                          }}
                          content={{
                            allowedContent: null
                          }}
                          appearance={{
                            button: "bg-blue-600 hover:bg-blue-700 text-sm h-9 px-4 transition-all duration-200 active:scale-95",
                            container: "w-max",
                          }}
                        />
                        <p className="text-[11px] font-medium text-muted-foreground">Logo appears in sidebar (max 4MB)</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chama-name">Chama Name</Label>
                    <Input 
                      id="chama-name" 
                      value={chamaSettings.name}
                      onChange={(e) => setChamaSettings({...chamaSettings, name: e.target.value})}
                      placeholder="Group Name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chama-phone">Group Phone / WhatsApp</Label>
                    <Input 
                      id="chama-phone" 
                      value={chamaSettings.phone}
                      onChange={(e) => setChamaSettings({...chamaSettings, phone: e.target.value})}
                      placeholder="+254..."
                    />
                  </div>

                  <Separator className="my-4" />

                  {/* Payment config now lives in Integrations > M-Pesa */}
                  <div className="rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 p-4 flex gap-3 items-start">
                    <Smartphone className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                        M-Pesa Payment Setup
                      </p>
                      <p className="text-xs text-green-700 dark:text-green-400 mt-0.5 leading-relaxed">
                        Set up your Paybill/Till number and Passkey in the{" "}
                        <button
                          type="button"
                          onClick={() => setActiveTab("integrations")}
                          className="font-semibold underline underline-offset-2 hover:opacity-80"
                        >
                          Integrations tab
                        </button>
                        . API authentication is handled securely by the ChamaSmart platform — you only need your receiving details.
                      </p>
                    </div>
                  </div>

                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving..." : "Save Chama Settings"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="integrations" className="mt-6">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <IntegrationCard 
                title="M-Pesa (Daraja)"
                description="Connect Safaricom M-Pesa for instant payments and STK Push."
                type="MPESA"
                icon={<Smartphone className="w-8 h-8 text-green-600" />}
              />
              <IntegrationCard 
                title="Paystack"
                description="Accept card payments and bank transfers globally."
                type="PAYSTACK"
                icon={<CreditCard className="w-8 h-8 text-blue-600" />}
              />
              <IntegrationCard 
                title="Bank (KCB/Equity)"
                description="Receive automated alerts from your bank account."
                type="BANK"
                icon={<Landmark className="w-8 h-8 text-purple-600" />}
              />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
