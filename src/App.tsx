import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "@/pages/Index";
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
          <Route element={<AppShell />}>
            <Route index element={<Index />} />
            <Route path="verify" element={<Verify />} />
            <Route path="verify/:scriptId" element={<Verify />} />
            <Route path="queue" element={<Queue />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        <Toaster />
      </TooltipProvider>
    </AppStoreProvider>
  );
}
