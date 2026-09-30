import { Car, Heart, Home, LayoutGrid, Sparkles, Truck, Wrench, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  home: Home,
  heart: Heart,
  car: Car,
  wrench: Wrench,
  truck: Truck,
};

export function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && icons[name]) || LayoutGrid;
  return <Icon aria-hidden className={className} />;
}
