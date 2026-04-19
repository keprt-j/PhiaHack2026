import Link from "next/link"
import { Mail, ArrowLeft } from "lucide-react"
import { MobileAppFrame } from "@/components/mobile-app-frame"

export default function SignUpSuccessPage() {
  return (
    <MobileAppFrame innerClassName="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      <header className="shrink-0 p-3 sm:p-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to home
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-12 pt-2">
        <div className="w-full max-w-sm text-center">
          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-accent" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">
            Check your email
          </h1>
          <p className="text-muted-foreground mb-8">
            {"We've sent you a confirmation link. Click it to activate your account and start discovering your style."}
          </p>

          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
          >
            Back to Sign In
          </Link>
        </div>
      </main>
      </div>
    </MobileAppFrame>
  )
}
