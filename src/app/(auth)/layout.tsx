import { Container } from "@/components/layout/container";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <Container className="flex flex-1 flex-col items-center py-10 sm:py-16">
      <div className="w-full max-w-md">{children}</div>
    </Container>
  );
}
