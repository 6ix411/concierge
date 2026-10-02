"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";

/**
 * The "Compare selected" button for a results form. On phones it becomes a bar above the tab bar
 * as soon as a provider is ticked, so customers don't have to scroll to the end of the list.
 */
export function CompareSubmit() {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setSelected(form.querySelectorAll('input[name="ids"]:checked').length);
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, []);

  return (
    <div ref={ref} className="contents">
      <Button type="submit" variant="outline" className="max-md:hidden">
        Compare selected
      </Button>
      {selected > 0 && (
        <div
          className="fixed inset-x-0 bottom-(--bottom-nav) z-20 flex items-center gap-3 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden"
          data-testid="compare-bar"
        >
          <p className="flex-1 text-sm" aria-live="polite">
            {selected === 1 ? "Tick one more to compare" : `${selected} providers selected`}
          </p>
          <Button type="submit" disabled={selected < 2}>
            Compare
          </Button>
        </div>
      )}
    </div>
  );
}
