import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AdminUser, SystemSettings, SystemHealth, AuditLog } from '@/types/admin';

async function fetchSystemSettings(): Promise<SystemSettings> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return data;
}

async function fetchAdminUsers(): Promise<AdminUser[]> {
  try {
    console.log('Attempting to fetch admin users...');
    
    // Try simple direct query first
    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Direct query error:', error);
      throw error;
    }

    console.log(`Successfully fetched ${data?.length || 0} users`);
    
    return (data ?? []).map(user => ({
      id: user.id,
      email: user.email,
      role: user.role || 'user',
      subscription_status: user.subscription_status || 'none',
      trial_ends_at: user.trial_ends_at,
      created_at: user.created_at,
    }));
  } catch (error) {
    console.error('Error in fetchAdminUsers:', error);
    throw error;
  }
}

async function fetchSystemHealth(): Promise<SystemHealth> {
  try {
    console.log('Fetching system health...');
    
    // Simple fallback to avoid RPC dependency
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, subscription_status, trial_ends_at');
    
    if (usersError) {
      console.error('Error fetching users for health:', usersError);
      throw usersError;
    }

    const totalUsers = users?.length || 0;
    const activeSubscriptions = users?.filter(u => u.subscription_status === 'active').length || 0;
    const trialingUsers = users?.filter(u => u.subscription_status === 'trialing').length || 0;

    // Get active cycles count
    const { count: activeCycles, error: cyclesError } = await supabase
      .from('reconciliation_cycles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress');

    if (cyclesError) {
      console.error('Error fetching cycles:', cyclesError);
    }

    return {
      total_users: totalUsers,
      active_subscriptions: activeSubscriptions,
      trialing_users: trialingUsers,
      active_cycles: activeCycles || 0,
      recent_webhook_errors: 0,
    };
  } catch (error) {
    console.error('Error in fetchSystemHealth:', error);
    throw error;
  }
}

async function fetchAuditLogs(): Promise<AuditLog[]> {
  try {
    console.log('Fetching audit logs...');
    
    // Simple fallback - return empty array if audit_logs table doesn't exist
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.log('Audit logs table might not exist:', error);
      return []; // Return empty array instead of throwing error
    }

    return data ?? [];
  } catch (error) {
    console.log('Error in fetchAuditLogs:', error);
    return []; // Return empty array instead of throwing error
  }
}

async function extendTrial(userId: string, days: number): Promise<void> {
  try {
    // Calculate new trial end date
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('trial_ends_at')
      .eq('id', userId)
      .single();

    if (fetchError) throw fetchError;

    const currentEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('users')
      .update({ 
        trial_ends_at: newEnd.toISOString(),
        subscription_status: 'trialing'
      })
      .eq('id', userId);

    if (error) throw error;
  } catch (error) {
    console.error('Error in extendTrial:', error);
    throw error;
  }
}

async function activateSubscription(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('users')
      .update({ subscription_status: 'active' })
      .eq('id', userId);

    if (error) throw error;
  } catch (error) {
    console.error('Error in activateSubscription:', error);
    throw error;
  }
}

async function revokeAccess(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('users')
      .update({ subscription_status: 'revoked' })
      .eq('id', userId);

    if (error) throw error;
  } catch (error) {
    console.error('Error in revokeAccess:', error);
    throw error;
  }
}

async function updatePricing(priceCents: number, trialDays: number): Promise<void> {
  try {
    const { error } = await supabase
      .from('system_settings')
      .update({ 
        subscription_price_cents: priceCents,
        trial_days: trialDays
      })
      .eq('id', 1);

    if (error) throw error;
  } catch (error) {
    console.error('Error in updatePricing:', error);
    throw error;
  }
}

async function createCheckoutSession(priceCents: number): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { price_cents: priceCents },
  });
  if (error) throw error;
  return data;
}

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: fetchSystemSettings,
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 30000,
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ['audit-logs'],
    queryFn: fetchAuditLogs,
  });
}

export function useExtendTrial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, days }: { userId: string; days: number }) => extendTrial(userId, days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['system-health'] });
    },
  });
}

export function useActivateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['system-health'] });
    },
  });
}

export function useRevokeAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAccess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['system-health'] });
    },
  });
}

export function useUpdatePricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ priceCents, trialDays }: { priceCents: number; trialDays: number }) =>
      updatePricing(priceCents, trialDays),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: createCheckoutSession,
  });
}
