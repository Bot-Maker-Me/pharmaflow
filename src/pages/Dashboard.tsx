import { Package, FileText, Scale, TrendingUp, AlertTriangle, Activity, ShoppingCart, Search, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useDrugs } from '@/hooks/useDrugs';
import { usePrescriptions } from '@/hooks/usePrescriptions';
import { useReconciliationCycles } from '@/hooks/useReconciliation';
import { useAuth } from '@/context/AuthContext';
import { hasAccess, formatPrice } from '@/types/admin';
import { useSystemSettings } from '@/hooks/useAdmin';
import { useAllReconciliationItems } from '@/hooks/useReconciliation';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const { data: drugs, isLoading: drugsLoading } = useDrugs();
  const { data: prescriptions, isLoading: prescriptionsLoading } = usePrescriptions();
  const { data: cycles, isLoading: cyclesLoading } = useReconciliationCycles();
  const { data: allReconciliationItems } = useAllReconciliationItems();
  const { profile } = useAuth();
  const { data: settings } = useSystemSettings();

  const totalDrugs = drugs?.length ?? 0;
  const lowStockCount = drugs?.filter((d) => d.current_stock <= d.reorder_level).length ?? 0;
  const activePrescriptions = prescriptions?.filter((p) => p.status === 'active').length ?? 0;
  const activeCycles = cycles?.filter((c) => c.status === 'in_progress').length ?? 0;
  const pendingDispenses = prescriptions?.filter((p) => p.quantity_dispensed < p.quantity_prescribed).length ?? 0;

  const recentActivity = useMemo(() => {
    if (drugsLoading || prescriptionsLoading || cyclesLoading) return [];
    
    const activities: Array<{
      type: 'reconciliation' | 'prescription' | 'dispense';
      message: string;
      time: Date;
      icon: typeof Scale;
    }> = [];
    
    // Add reconciliation completions
    cycles?.filter(c => c.status === 'completed').slice(0, 3).forEach(cycle => {
      activities.push({
        type: 'reconciliation',
        message: `Reconciliation cycle completed`,
        time: new Date(cycle.created_at),
        icon: Scale,
      });
    });
    
    // Add recent prescriptions
    prescriptions?.slice(0, 3).forEach(rx => {
      activities.push({
        type: 'prescription',
        message: `Prescription for ${rx.patient_name}`,
        time: new Date(rx.created_at),
        icon: FileText,
      });
    });
    
    // Add dispense activities from reconciliation items
    allReconciliationItems?.slice(0, 3).forEach(item => {
      if (item.dispensed_count > 0) {
        activities.push({
          type: 'dispense',
          message: `Dispensed ${item.dispensed_count} units of ${item.description}`,
          time: new Date(item.created_at),
          icon: Activity,
        });
      }
    });
    
    return activities.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 6);
  }, [cycles, prescriptions, allReconciliationItems, drugsLoading, prescriptionsLoading, cyclesLoading]);

  // Prepare chart data for inventory trends
  const inventoryChartData = useMemo(() => {
    if (drugsLoading || !drugs || drugs.length === 0) return [];
    
    const topNarcotics = drugs
      .filter(d => d.schedule === 'Narcotic' || d.schedule === 'Controlled')
      .sort((a, b) => b.current_stock - a.current_stock)
      .slice(0, 5);
    
    return topNarcotics.map(drug => ({
      name: drug.description.substring(0, 20) + (drug.description.length > 20 ? '...' : ''),
      stock: drug.current_stock,
      reorder: drug.reorder_level,
    }));
  }, [drugs, drugsLoading]);

  // Prepare schedule distribution data
  const scheduleChartData = useMemo(() => {
    if (drugsLoading || !drugs || drugs.length === 0) return [];
    
    const scheduleCounts = drugs.reduce((acc, drug) => {
      acc[drug.schedule] = (acc[drug.schedule] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const colors = ['#14b8a6', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
    
    return Object.entries(scheduleCounts).map(([name, value], index) => ({
      name,
      value,
      color: colors[index % colors.length],
    }));
  }, [drugs, drugsLoading]);

  const stats = [
    {
      label: 'Total Inventory Items',
      value: totalDrugs,
      change: `${lowStockCount} low stock`,
      icon: Package,
      iconBg: 'bg-primary-50',
      iconText: 'text-primary-600',
      changeText: lowStockCount > 0 ? 'text-warning-600' : 'text-primary-600',
    },
    {
      label: 'Active Prescriptions',
      value: activePrescriptions,
      change: `${pendingDispenses} pending dispense`,
      icon: FileText,
      iconBg: 'bg-secondary-50',
      iconText: 'text-secondary-600',
      changeText: 'text-secondary-600',
    },
    {
      label: 'Reconciliation Cycles',
      value: activeCycles,
      change: activeCycles > 0 ? 'In progress' : 'All completed',
      icon: Scale,
      iconBg: 'bg-warning-50',
      iconText: 'text-warning-600',
      changeText: activeCycles > 0 ? 'text-warning-600' : 'text-success-600',
    },
    {
      label: 'Low Stock Alerts',
      value: lowStockCount,
      change: lowStockCount > 0 ? 'Action needed' : 'All good',
      icon: AlertTriangle,
      iconBg: 'bg-error-50',
      iconText: 'text-error-600',
      changeText: lowStockCount > 0 ? 'text-error-600' : 'text-success-600',
    },
  ];

  const lowStockDrugs = (drugs ?? []).filter((d) => d.current_stock <= d.reorder_level).slice(0, 5);

  if (drugsLoading || prescriptionsLoading || cyclesLoading) {
    return <DashboardSkeleton />;
  }

  const trialActive = profile?.subscription_status === 'trialing' && hasAccess(profile);
  
  // Trial expiry banner (3 days before)
  const showTrialWarning = trialActive && profile?.trial_ends_at && 
    new Date(profile.trial_ends_at) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) &&
    new Date(profile.trial_ends_at) > new Date();

  const pastDue = profile?.subscription_status === 'past_due';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500">Overview of your pharmacy operations</p>
      </div>

      {/* Trial expiry banner */}
      {showTrialWarning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-5 py-4"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-100">
            <AlertTriangle className="h-4 w-4 text-warning-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-neutral-800">
              Your trial ends soon
            </p>
            <p className="text-xs text-neutral-500">
              Trial ends on{' '}
              {new Date(profile.trial_ends_at!).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              {settings && ` · Upgrade to continue for ${formatPrice(settings.subscription_price_cents)}/mo`}
            </p>
          </div>
          <Link to="/settings" className="btn-primary text-xs">
            Upgrade Now
          </Link>
        </motion.div>
      )}

      {/* Past due banner */}
      {pastDue && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-3 rounded-xl border border-error-200 bg-error-50 px-5 py-4"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-error-100">
            <AlertTriangle className="h-4 w-4 text-error-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-neutral-800">
              Payment failed
            </p>
            <p className="text-xs text-neutral-500">
              Your subscription payment failed. Please update your payment method to continue service.
            </p>
          </div>
          <Link to="/settings" className="btn-primary text-xs">
            Update Payment
          </Link>
        </motion.div>
      )}

      {/* Trial banner (normal) */}
      {trialActive && !showTrialWarning && profile?.trial_ends_at && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-warning-100 bg-warning-50/50 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-100">
            <TrendingUp className="h-4 w-4 text-warning-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-neutral-800">
              You're on a free trial
            </p>
            <p className="text-xs text-neutral-500">
              Trial ends on{' '}
              {new Date(profile.trial_ends_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              {settings && ` · ${formatPrice(settings.subscription_price_cents)}/mo after`}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="card p-5 transition-all duration-200 hover:shadow-elevated"
            >
              <div className="flex items-center justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.iconBg}`}>
                  <Icon className={`h-5 w-5 ${stat.iconText}`} />
                </div>
                <TrendingUp className="h-4 w-4 text-neutral-300" />
              </div>
              <p className="mt-4 text-2xl font-bold text-neutral-900">{stat.value}</p>
              <p className="mt-0.5 text-sm text-neutral-500">{stat.label}</p>
              <p className={`mt-2 text-xs font-medium ${stat.changeText}`}>{stat.change}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Activity Feed */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Recent Activity</h2>
            <div className="flex items-center gap-2">
              <button className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100" title="Filter">
                <Filter className="h-4 w-4" />
              </button>
              <button className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100" title="Search">
                <Search className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-1">
            {recentActivity.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">No recent activity</p>
            ) : (
              recentActivity.map((activity, index) => {
                const Icon = activity.icon;
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-neutral-50"
                  >
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      activity.type === 'reconciliation' ? 'bg-success-400' :
                      activity.type === 'prescription' ? 'bg-primary-400' :
                      'bg-secondary-400'
                    }`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-neutral-800">{activity.message}</p>
                      <p className="text-xs text-neutral-400">
                        {activity.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · 
                        {activity.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      activity.type === 'reconciliation' ? 'bg-success-50' :
                      activity.type === 'prescription' ? 'bg-primary-50' :
                      'bg-secondary-50'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        activity.type === 'reconciliation' ? 'text-success-600' :
                        activity.type === 'prescription' ? 'text-primary-600' :
                        'text-secondary-600'
                      }`} />
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-neutral-900">Quick Actions</h2>
          <div className="mt-4 space-y-2">
            <QuickActionLink to="/reconciliation" label="Start Reconciliation" icon={Scale} />
            <QuickActionLink to="/prescriptions" label="New Prescription" icon={FileText} />
            <QuickActionLink to="/inventory" label="Add Inventory Item" icon={Package} />
            <QuickActionLink to="/transactions" label="Manual Adjustment" icon={ShoppingCart} />
          </div>

          {lowStockDrugs.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Low Stock Alerts</h3>
              <div className="mt-2 space-y-1">
                {lowStockDrugs.map((drug) => (
                  <div key={drug.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                    <span className="text-neutral-700">{drug.description}</span>
                    <span className="font-medium text-error-600">{drug.current_stock}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Charts Section */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Inventory Trends Chart */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-neutral-900">Top Narcotics Inventory</h2>
          <p className="mt-1 text-sm text-neutral-500">Current stock levels for controlled substances</p>
          {inventoryChartData.length > 0 ? (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={inventoryChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '8px', 
                      border: '1px solid #f0f0f0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="stock" 
                    stroke="#14b8a6" 
                    strokeWidth={2}
                    dot={{ fill: '#14b8a6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="reorder" 
                    stroke="#ef4444" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 flex h-64 items-center justify-center text-neutral-400">
              <p className="text-sm">No inventory data available</p>
            </div>
          )}
        </div>

        {/* Schedule Distribution Chart */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-neutral-900">Schedule Distribution</h2>
          <p className="mt-1 text-sm text-neutral-500">Drug inventory by schedule type</p>
          {scheduleChartData.length > 0 ? (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={scheduleChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {scheduleChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '8px', 
                      border: '1px solid #f0f0f0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 flex h-64 items-center justify-center text-neutral-400">
              <p className="text-sm">No schedule data available</p>
            </div>
          )}
          {scheduleChartData.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {scheduleChartData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div 
                    className="h-3 w-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-xs text-neutral-600">{item.name} ({item.value})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickActionLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof FileText }) {
  return (
    <Link
      to={to}
      className="flex w-full items-center gap-3 rounded-lg border border-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-all hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
    >
      <Icon className="h-[18px] w-[18px]" />
      {label}
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-48 animate-pulse rounded bg-neutral-200" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-neutral-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-5">
            <div className="flex h-10 w-10 animate-pulse rounded-lg bg-neutral-200" />
            <div className="mt-4 h-8 w-16 animate-pulse rounded bg-neutral-200" />
            <div className="mt-2 h-4 w-24 animate-pulse rounded bg-neutral-200" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-neutral-200" />
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <div className="flex h-6 w-40 animate-pulse rounded bg-neutral-200" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex h-16 animate-pulse rounded-lg bg-neutral-100" />
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="h-6 w-32 animate-pulse rounded bg-neutral-200" />
          <div className="mt-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
