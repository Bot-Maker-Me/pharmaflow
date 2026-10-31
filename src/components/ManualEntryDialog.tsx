import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Keyboard, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/app-store";

const schema = z.object({
  full_name: z.string().min(2, "Enter the patient name"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  health_card_num: z.string().min(4, "Enter the health card number"),
  prescriber_name: z.string().min(2, "Enter the prescriber"),
  license_number: z.string().min(2, "Enter the CPSO / provincial licence"),
  drug_name: z.string().min(2, "Enter the drug name"),
  din: z.string().regex(/^\d{8}$/, "DIN must be 8 digits"),
  strength: z.string().min(1, "Enter the strength"),
  quantity: z.string().regex(/^\d+$/, "Digits only"),
  refills: z.string().regex(/^\d+$/, "Digits only"),
  sig: z.string().min(3, "Enter the directions"),
  is_compound: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  full_name: "",
  dob: "",
  health_card_num: "",
  prescriber_name: "",
  license_number: "",
  drug_name: "",
  din: "",
  strength: "",
  quantity: "30",
  refills: "0",
  sig: "",
  is_compound: false,
};

export function ManualEntryDialog() {
  const { createManualScript } = useAppStore();
  const [open, setOpen] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  const onSubmit = (values: FormValues) => {
    createManualScript({
      ...values,
      quantity: Number(values.quantity),
      refills: Number(values.refills),
    });
    reset(DEFAULTS);
    setOpen(false);
  };

  const field = (
    name: keyof FormValues,
    label: string,
    placeholder: string,
    className?: string,
  ) => (
    <div className={className}>
      <Label htmlFor={`manual-${name}`}>{label}</Label>
      <Input id={`manual-${name}`} placeholder={placeholder} {...register(name)} className="mt-1.5" />
      {errors[name] ? <p className="mt-1 text-[11px] text-destructive">{errors[name]?.message}</p> : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Keyboard className="h-4 w-4" />
          Manual entry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Key in a prescription</DialogTitle>
          <DialogDescription>
            Use this when a fax is unreadable or a prescriber phones in a prescription. The record joins the
            same verification queue as AI-extracted scripts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {field("full_name", "Patient name", "Jane Doe", "sm:col-span-2")}
            {field("dob", "Date of birth", "1980-01-31")}
            {field("health_card_num", "Health card #", "1234-567-890-ON")}
            {field("prescriber_name", "Prescriber", "Dr. Sarah Jenkins")}
            {field("license_number", "Licence #", "CPSO 78901")}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {field("drug_name", "Drug name", "Apo-Amoxi 500 mg", "sm:col-span-2")}
            {field("din", "DIN", "00628115")}
            {field("strength", "Strength", "500 mg")}
            {field("quantity", "Quantity", "30")}
            {field("refills", "Refills", "2")}
            <div className="sm:col-span-2 flex items-end">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                  {...register("is_compound")}
                />
                Custom compound (no DIN)
              </label>
            </div>
          </div>

          <div>
            <Label htmlFor="manual-sig">Sig / directions</Label>
            <Textarea
              id="manual-sig"
              placeholder="Take 1 capsule by mouth three times daily for 10 days"
              className="mt-1.5"
              {...register("sig")}
            />
            {errors.sig ? <p className="mt-1 text-[11px] text-destructive">{errors.sig.message}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <Plus className="h-4 w-4" />
              Add to queue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
