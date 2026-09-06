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
  const { data, error } = await supabase.rpc('admin_list_users');
  if (error) throw error;
  return data ?? [];
}

async function fetchSystemHealth(): Promise<SystemHealth> {
  const { data, error } = await supabase.rpc('admin_system_health');
  if (error) throw error;
  return data;
}

async function fetchAuditLogs(): Promise<AuditLog[]> {
  const { data, error } = await supabase.rpc('admin_list_audit_logs', { p_limit: 50 });
  if (error) throw error;
  return data ?? [];
}

async function extendTrial(userId: string, days: number): Promise<void> {
  const { error } = await supabase.rpc('admin_extend_trial', {
    p_user_id: userId,
    p_days: days,
  });
  if (error) throw error;
}

async function activateSubscription(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_activate_subscription', {
    p_user_id: userId,
  });
  if (error) throw error;
}

async function revokeAccess(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_access', {
    p_user_id: userId,
  });
  if (error) throw error;
}

async function updatePricing(priceCents: number, trialDays: number): Promise<void> {
  const { error } = await supabase.rpc('admin_update_pricing', {
    p_price_cents: priceCents,
    p_trial_days: trialDays,
  });
  if (error) throw error;
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
