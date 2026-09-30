import { Container } from "./container";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-6 text-sm text-muted">
      <Container>© {new Date().getFullYear()} Concierge by 6IX</Container>
    </footer>
  );
}
