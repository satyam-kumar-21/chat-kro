import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";

export default function LoginLivePage() {
  return <Suspense><LoginForm live /></Suspense>;
}
