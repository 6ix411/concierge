"use client";

import { ArrowRight } from "lucide-react";
import Form from "next/form";
import { useRef } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export const conciergeExamples = [
  "I need a wedding decorator in Lekki for 300 guests with a ₦1.5m budget.",
  "Deep cleaning for a 3-bedroom flat in Ajah this Saturday.",
  "Bridal makeup artist in Ikoyi under ₦200k.",
  "A plumber in Ikeja to fix a leaking pipe today.",
];

export function ConciergeBox({
  defaultValue,
  autoFocus = false,
  compact = false,
  showExamples = true,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  compact?: boolean;
  showExamples?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <Form
        action="/concierge"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-sm"
      >
        <label htmlFor="concierge-query" className="sr-only">
          Describe what you need
        </label>
        <textarea
          ref={ref}
          id="concierge-query"
          name="q"
          required
          minLength={3}
          maxLength={500}
          rows={compact ? 2 : 3}
          autoFocus={autoFocus}
          defaultValue={defaultValue}
          placeholder={conciergeExamples[0]}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="w-full resize-none bg-transparent px-1 text-base leading-relaxed outline-none placeholder:text-muted"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="hidden text-xs text-muted sm:block">
            Only verified businesses on Concierge are recommended.
          </p>
          <Button
            type="submit"
            variant="accent"
            size={compact ? "md" : "lg"}
            className={cn(!compact && "w-full sm:w-auto")}
          >
            Find My Provider
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        </div>
      </Form>
      {showExamples && (
        <div className="flex [scrollbar-width:none] gap-2 overflow-x-auto pb-1">
          {conciergeExamples.slice(1).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                if (!ref.current) return;
                ref.current.value = example;
                ref.current.focus();
              }}
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
