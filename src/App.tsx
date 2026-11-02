import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Inbox from "@/pages/Inbox";
import Index from "@/pages/Index";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";
import Queue from "@/pages/Queue";
import Settings from "@/pages/Settings";
import Verify from "@/pages/Verify";
import { AppStoreProvider } from "@/store/app-store";

export default function App() {
  return (
    <AppStoreProvider>
      <TooltipProvider delayDuration={200}>
        <Routes>
          {/* Public marketing home */}
          <Route path="/" element={<Landing />} />

          {/* Application shell */}
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Index />} />
            <Route path="verify" element={<Verify />} />
            <Route path="verify/:scriptId" element={<Verify />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="queue" element={<Queue />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Keep old paths working by redirecting into /app */}
          <Route path="/verify" element={<AppShell />}>
            <Route index element={<Verify />} />
            <Route path=":scriptId" element={<Verify />} />
          </Route>
          <Route path="/queue" element={<AppShell />}>
            <Route index element={<Queue />} />
          </Route>
          <Route path="/settings" element={<AppShell />}>
            <Route index element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </TooltipProvider>
    </AppStoreProvider>
  );
}
