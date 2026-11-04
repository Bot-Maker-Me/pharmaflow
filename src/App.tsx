import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Inbox from "@/pages/Inbox";
import Index from "@/pages/Index";
import Landing from "@/pages/Landing";
import Live from "@/pages/Live";
import Login from "@/pages/Login";
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
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Index />} />
            <Route path="verify" element={<Verify />} />
            <Route path="verify/:scriptId" element={<Verify />} />
            <Route path="live" element={<Live />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="queue" element={<Queue />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </TooltipProvider>
    </AppStoreProvider>
  );
}
