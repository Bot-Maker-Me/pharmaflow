import { Toaster as Sonner, toast } from "sonner";

const Toaster = () => (
  <Sonner
    theme="light"
    position="bottom-right"
    className="toaster group"
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-2 group-[.toaster]:border-pf-ink group-[.toaster]:shadow-[4px_4px_0_0_#101418]",
        description: "group-[.toast]:text-muted-foreground",
        actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    }}
  />
);

export { Toaster, toast };
