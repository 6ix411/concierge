import { Button } from "@/components/ui";
import { signOutAction } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm" className="whitespace-nowrap">
        Sign out
      </Button>
    </form>
  );
}
