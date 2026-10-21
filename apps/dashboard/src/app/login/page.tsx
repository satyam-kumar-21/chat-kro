import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
