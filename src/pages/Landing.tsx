import { Link } from 'react-router-dom';
import { Pill, Shield, BarChart3, Clock, CheckCircle2, ArrowRight } from 'lucide-react';

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
              <span className="text-lg font-bold text-neutral-900">PharmaFlow</span>
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
                <Link
                  to="/login"
                  className="btn-secondary inline-flex items-center justify-center px-8 py-3 text-base"
                >
                  View Demo
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="relative bg-white rounded-2xl shadow-2xl p-6 border border-neutral-100">
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-success-50 rounded-lg">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success-100">
                      <CheckCircle2 className="h-5 w-5 text-success-600" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">Reconciliation Complete</p>
                      <p className="text-sm text-neutral-600">245 drugs verified successfully</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-warning-50 rounded-lg">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-100">
                      <Clock className="h-5 w-5 text-warning-600" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">Low Stock Alert</p>
                      <p className="text-sm text-neutral-600">3 drugs need attention</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-primary-50 rounded-lg">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100">
                      <BarChart3 className="h-5 w-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">Inventory Updated</p>
                      <p className="text-sm text-neutral-600">Auto-synced from McKesson</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-neutral-900 mb-4">
              Everything You Need for Compliance
            </h2>
            <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
              Streamline your pharmacy operations with tools designed specifically for Canadian regulations
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={Shield}
              title="Narcotic Reconciliation"
              description="Automated reconciliation cycles with McKesson and Kroll file import, variance detection, and compliance reporting."
            />
            <FeatureCard
              icon={BarChart3}
              title="Inventory Management"
              description="Real-time stock tracking, low stock alerts, and automated purchase order generation."
            />
            <FeatureCard
              icon={Clock}
              title="Prescription Tracking"
              description="Complete prescription management with patient records, refill tracking, and dispensing logs."
            />
            <FeatureCard
              icon={Shield}
              title="Compliance Reports"
              description="Generate regulatory-ready reports for inspections with one click, including Controlled Substance logs."
            />
            <FeatureCard
              icon={BarChart3}
              title="Analytics Dashboard"
              description="Visual insights into inventory trends, dispensing patterns, and reconciliation performance."
            />
            <FeatureCard
              icon={Clock}
              title="Audit Trail"
              description="Complete activity logging for compliance and security, with user-level tracking."
            />
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
            Join hundreds of Canadian pharmacies using PharmaFlow to streamline compliance and improve efficiency.
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
              <span className="text-lg font-bold text-white">PharmaFlow</span>
            </div>
            <p className="text-sm">
              © 2026 PharmaFlow. Built for Canadian pharmacies.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="card p-6 hover:shadow-lg transition-shadow">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 mb-4">
        <Icon className="h-6 w-6 text-primary-600" />
      </div>
      <h3 className="text-lg font-semibold text-neutral-900 mb-2">{title}</h3>
      <p className="text-neutral-600">{description}</p>
    </div>
  );
}