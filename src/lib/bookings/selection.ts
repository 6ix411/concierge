import type { PricedService } from "./rules";

export type SelectableService = PricedService & {
  is_package: boolean;
  is_addon: boolean;
  duration_minutes: number | null;
};

export type ItemKind = "service" | "package" | "addon";

export type SelectedLine = { serviceId: string; quantity: number; kind: ItemKind };

export type SelectionResult =
  | { ok: true; lines: SelectedLine[] }
  | { ok: false; field: "serviceIds" | "packageId" | null; message: string };

export function itemKind(service: { is_package: boolean; is_addon: boolean }): ItemKind {
  return service.is_package ? "package" : service.is_addon ? "addon" : "service";
}

/**
 * Checks what the customer picked against what the business currently offers: services, at most
 * one package, and add-ons (which need a service or package to go with).
 */
export function resolveSelection(
  services: SelectableService[],
  input: { serviceIds: string[]; packageId?: string; quantities: Record<string, number> },
): SelectionResult {
  const byId = new Map(services.map((service) => [service.id, service]));
  const stale = {
    ok: false as const,
    field: null,
    message: "One of the services is no longer available. Please refresh and try again.",
  };

  const lines: SelectedLine[] = [];
  if (input.packageId) {
    const pack = byId.get(input.packageId);
    if (!pack) return stale;
    if (!pack.is_package) return { ok: false, field: "packageId", message: "Choose one of the packages." };
    lines.push({ serviceId: pack.id, quantity: 1, kind: "package" });
  }
  for (const id of new Set(input.serviceIds)) {
    const service = byId.get(id);
    if (!service) return stale;
    if (service.is_package) {
      return { ok: false, field: "packageId", message: "Choose packages from the packages list." };
    }
    lines.push({ serviceId: id, quantity: input.quantities[id] ?? 1, kind: itemKind(service) });
  }

  if (lines.length > 0 && lines.every((line) => line.kind === "addon")) {
    return {
      ok: false,
      field: "serviceIds",
      message: "Add-ons are extras. Choose a service or package too.",
    };
  }
  return { ok: true, lines };
}
