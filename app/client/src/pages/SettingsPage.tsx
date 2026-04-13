import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type Settings } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

const schema = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
  yearStartDay: z.number().int().min(1).max(31),
});

export default function SettingsPage() {
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const { data: settings, isLoading } = useQuery<Settings>({ queryKey: ["/api/settings"] });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { yearStartMonth: 1, yearStartDay: 1 },
  });

  useEffect(() => {
    if (settings) {
      form.reset({ yearStartMonth: settings.yearStartMonth, yearStartDay: settings.yearStartDay });
    }
  }, [settings]);

  const mut = useMutation({
    mutationFn: (data: z.infer<typeof schema>) => apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const month = form.watch("yearStartMonth");
  const day = form.watch("yearStartDay");

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">Configure your time tracking preferences.</p>

      <div className="p-5 rounded-lg border bg-card">
        <div className="flex items-center gap-2 mb-1">
          <Calendar size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Custom Year Start</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Define when your tracking year begins. The Annual view will use this window for all summaries.
          For a fiscal year starting Oct 1, set month = 10 and day = 1.
        </p>

        {isLoading ? (
          <div className="h-32 bg-muted rounded animate-pulse" />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => mut.mutate(d))} className="space-y-4">
              <FormField control={form.control} name="yearStartMonth" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Month</FormLabel>
                  <FormControl>
                    <select
                      data-testid="select-year-start-month"
                      value={field.value}
                      onChange={e => field.onChange(Number(e.target.value))}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    >
                      {MONTH_NAMES.map((n, i) => (
                        <option key={i+1} value={i+1}>{n}</option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="yearStartDay" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Day</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-year-start-day"
                      type="number"
                      min={1}
                      max={31}
                      className="w-24"
                      {...field}
                      onChange={e => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    Day of month (1–31)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              {month && day && (
                <div className="p-3 rounded-md bg-muted text-sm text-muted-foreground">
                  Your year runs from <strong>{MONTH_NAMES[month-1]} {day}</strong> to <strong>{MONTH_NAMES[(month === 1 ? 12 : month) - 2] || MONTH_NAMES[11]} {day - 1 || 31}</strong> (next year).
                </div>
              )}

              <Button type="submit" disabled={mut.isPending} data-testid="button-save-settings" className="gap-1.5">
                {saved ? <><CheckCircle2 size={15} /> Saved</> : mut.isPending ? "Saving…" : "Save Settings"}
              </Button>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}
