import { Suspense } from "react";
import { SignupForm } from "@/components/auth-forms";

export default function SignupPage() {
  return <Suspense><SignupForm /></Suspense>;
}
