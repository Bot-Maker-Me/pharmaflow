import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 border px-2 py-0.5 font-data text-[11px] font-medium tracking-wide transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-pf-ink bg-pf-ink text-pf-sheet dark:border-pf-amber dark:bg-pf-amber dark:text-pf-ink",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive bg-destructive/10 text-destructive",
        outline: "border-pf-ink/40 bg-card text-foreground dark:border-border",
        success:
          "border-[#1F7A4D] bg-[#1F7A4D] text-white",
        warning: "border-pf-amber bg-pf-amber/20 text-pf-ink dark:text-pf-amber",
        info: "border-pf-rule bg-pf-paper text-pf-slate dark:bg-secondary dark:text-foreground",
        violet:
          "border-pf-ink bg-card text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
