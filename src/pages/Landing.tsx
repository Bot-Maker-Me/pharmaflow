import { Link } from 'react-router-dom';
import { Pill, Shield, ArrowRight } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-secondary-50">
      {/* Navigation */}
      <nav className="border-b border-neutral-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
                <Pill className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold text-neutral-900">Narcotics Ledger</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/login"
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
              >
                Log in
              </Link>
              <Link
                to="/signup"
                className="btn-primary inline-flex items-center gap-2"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700 mb-6">
                <Shield className="h-4 w-4" />
                Compliant with Canadian Pharmacy Regulations
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-neutral-900 leading-tight mb-6">
                Modern Pharmacy
                <span className="text-primary-600"> Reconciliation</span>
                Made Simple
              </h1>
              <p className="text-lg text-neutral-600 mb-8 max-w-xl">
                Streamline your narcotic tracking, inventory management, and reconciliation with an intuitive platform built for Canadian pharmacies.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  to="/signup"
                  className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-3 text-base"
                >
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary-600">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Modernize Your Pharmacy?
          </h2>
          <p className="text-lg text-primary-100 mb-8 max-w-2xl mx-auto">
            Join hundreds of Canadian pharmacies using Narcotics Ledger to streamline compliance and improve efficiency.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center justify-center gap-2 bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
          >
            Start Your Free Trial
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-neutral-900 text-neutral-400 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2.5 mb-4 md:mb-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
                <Pill className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold text-white">Narcotics Ledger</span>
            </div>
            <p className="text-sm">
              © 2026 Narcotics Ledger. Built for Canadian pharmacies.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}