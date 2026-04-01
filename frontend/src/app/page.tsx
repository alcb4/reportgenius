import { redirect } from "next/navigation";

/**
 * Root page — redirect to /dashboard.
 * The app layout handles auth protection: unauthenticated users will be
 * sent to /login from there.
 */
export default function RootPage() {
  redirect("/dashboard");
}
