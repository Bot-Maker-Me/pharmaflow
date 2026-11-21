import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border-2 border-pf-ink text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-border disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        amber: "border-pf-ink bg-pf-amber text-pf-ink hover:bg-pf-amber/85 dark:border-pf-amber",
        destructive: "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "bg-card text-foreground hover:bg-pf-ink hover:text-pf-sheet",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "border-transparent hover:bg-secondary hover:text-secondary-foreground",
        link: "border-transparent text-foreground underline underline-offset-4 hover:text-pf-amber",
        success: "border-pf-ink bg-[#1F7A4D] text-white hover:bg-[#1A6641] dark:border-[#1F7A4D]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-sm",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
