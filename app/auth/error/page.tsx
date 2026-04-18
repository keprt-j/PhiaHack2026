import Link from "next/link"
import { AlertCircle, ArrowLeft } from "lucide-react"
import { MobileAppFrame } from "@/components/mobile-app-frame"

export default function AuthErrorPage() {
  return (
    <MobileAppFrame innerClassName="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
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
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-destructive" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">
            Authentication Error
          </h1>
          <p className="text-muted-foreground mb-8">
            Something went wrong during authentication. Please try again.
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              Try Again
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-secondary text-secondary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              Go to Home
            </Link>
          </div>
        </div>
      </main>
      </div>
    </MobileAppFrame>
  )
}
